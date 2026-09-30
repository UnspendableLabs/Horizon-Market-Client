import type { HttpClient } from "../api/http.js";
import {
  commitTxidFromCreationError,
  creationSubmitMayHaveBroadcast,
  requestCreationQuote,
  submitCreation,
  type CounterpartyCreationOptions,
  type CreatableType,
  type CreationAttributes,
  type CreationQuote,
  type CreationQuoteParams,
  type CreationResult,
  type SubmitCreationParams,
} from "../api/creations.js";
import { assertCreationQuoteParams } from "../creation-params.js";
import { isTaprootAddress } from "../sell-params.js";
import type { Signer } from "../crypto/signer.js";
import {
  assertCommitUnchanged,
  carriesInlineCounterpartyData,
  readRevealCommit,
  revealToSign,
  signerKeys,
  signVerifiedReveal,
  verifyReveal,
  type VerifiedReveal,
} from "../crypto/reveal.js";
import type * as btc from "bitcoinjs-lib";
import type { WorkflowOptions } from "../types/index.js";
import { psbtBase64ToHex } from "../utils.js";
import { WorkflowProgressReporter } from "./progress.js";

export interface CreateTokenParams {
  type: CreatableType;
  name: string;
  description?: string;
  /** `ipfs://` URI — see `uploadCreationMedia`. */
  image: string;
  thumbnail?: string;
  attributes?: CreationAttributes;
  /** Funding + receiving address. Defaults to the signer's native segwit one. */
  address?: string;
  /** Where an inscription lands. Defaults to the signer's P2TR address. */
  taprootAddress?: string;
  /**
   * Hex key of `address`, x-only or compressed. Resolved from the signer when
   * `address` is one of its own: the x-only key of its taproot address, and on
   * a Counterparty creation the compressed key of its native-segwit one — the
   * key that closes the taproot envelope a long description needs, so the
   * wallet can sign the reveal. Pass it for any other address: required for
   * taproot, and for a Counterparty issuance that may need an envelope.
   */
  publicKey?: string;
  /** sat/vB — marshalled into `options.fee_rate`. */
  satsPerVbyte?: number;
  /** Counterparty supply / divisibility / lock. Ignored for ordinals. */
  options?: Omit<CounterpartyCreationOptions, "feeRate">;
  /**
   * A quote already obtained for these exact params — supplying it **skips** the
   * quote step.
   *
   * This is what makes a confirm-modal flow honest: the fees the user approved
   * are the fees they sign, and one attempt pins one descriptor. Without it, the
   * numbers on screen come from a quote that is then thrown away.
   */
  quote?: CreationQuote;
}

export interface CreateTokenResult extends CreationResult {
  /** The quote the broadcast transaction was composed from. */
  quote: CreationQuote;
}

/**
 * The transaction was signed and submitted, and the server did not confirm the
 * creation.
 *
 * `submit` is the **exact body to re-POST**. Broadcasting is idempotent, so
 * replaying it is safe, and it is the only correct recovery: re-running
 * {@link createToken} takes a fresh quote and therefore composes a *second*
 * transaction — for Counterparty a duplicate issuance attempt against the same
 * UTXOs, and for ordinals a new commit that permanently strands the first one's
 * funds, since its reveal was signed by a key the server discarded at quote time.
 *
 * Two fields, because "what do we know" and "what can we show" are different
 * questions:
 *
 * - **`possiblyBroadcast`** is the one to branch on. It is `false` only when the
 *   server positively rejected the submit before touching a node (a `4xx`);
 *   a `5xx`, a timeout or a dropped connection all leave it `true`, because an
 *   unverifiable "nothing happened" is not worth a permanently stranded commit.
 * - **`commitTxid`** is for display, and is set only when the `502` named one.
 *   Its absence says nothing about whether anything was broadcast.
 */
export class CreationNotBroadcastError extends Error {
  readonly submit: SubmitCreationParams;
  readonly commitTxid: string | null;
  /** Whether re-composing could produce a second on-chain transaction. */
  readonly possiblyBroadcast: boolean;
  override readonly cause?: unknown;

  constructor(
    submit: SubmitCreationParams,
    commitTxid: string | null,
    cause: unknown,
  ) {
    const possiblyBroadcast =
      commitTxid !== null || creationSubmitMayHaveBroadcast(cause);
    super(
      commitTxid
        ? "Your transaction is on-chain, but the reveal that completes it was " +
            `rejected (commit ${commitTxid}). Retry re-sends the same signed ` +
            "transaction: nothing is signed or paid again."
        : possiblyBroadcast
          ? "The server could not confirm your transaction, and it may already " +
            "be on-chain. Retry re-sends the same signed one: nothing is " +
            "signed or paid again."
          : "The signed transaction could not be submitted. Retry re-sends the " +
            "same one — nothing is signed or paid again.",
    );
    this.name = "CreationNotBroadcastError";
    this.submit = submit;
    this.commitTxid = commitTxid;
    this.possiblyBroadcast = possiblyBroadcast;
    this.cause = cause;
  }
}

/** Everything needed to safely recover a {@link CreationNotBroadcastError}. */
export interface CreationRetry {
  /** Re-POST this via `submitCreation` — do not re-run `createToken`. */
  submit: SubmitCreationParams;
  commitTxid: string | null;
  /**
   * `true` when re-composing could broadcast a second transaction. Branch on
   * this, not on `commitTxid` — see {@link CreationNotBroadcastError}.
   */
  possiblyBroadcast: boolean;
}

/**
 * Recovery info from a caught error, or `null` when it is not a
 * {@link CreationNotBroadcastError}.
 */
export function creationRetry(error: unknown): CreationRetry | null {
  return error instanceof CreationNotBroadcastError
    ? {
        submit: error.submit,
        commitTxid: error.commitTxid,
        possiblyBroadcast: error.possiblyBroadcast,
      }
    : null;
}

/**
 * createToken — quote → sign → submit.
 *
 * 1. Resolve the funding / receiving addresses from the signer and validate.
 * 2. Request a creation quote (skipped when `params.quote` is supplied).
 * 3. Sign the quote's PSBT, unchanged apart from its witnesses.
 * 4. Counterparty issuance in a taproot envelope: sign the reveal too
 *    (`signRevealTx`) — the network attributes it to the funding address only
 *    when that address signed it (Counterparty Core ≥ 11.5.0).
 * 5. Submit it, together with the reveal: the one just signed, or for ordinals
 *    the pre-signed one the quote carried.
 *
 * @param btcNetwork the network the reveal PSBT is built for — the one the
 * wallet signs on.
 * @throws {PresignedRevealError} when a Counterparty quote carries a reveal
 * pre-signed by an out-of-date server, before anything is signed.
 * @throws {RevealVerificationError} when the reveal does not check out against
 * the commit, its funding address or this wallet's keys — before anything is
 * signed — or when the wallet changed the commit while signing it.
 * @throws {CreationNotBroadcastError} when the submit fails — recover with
 * {@link creationRetry}, never by calling this again.
 */
export async function createToken(
  params: CreateTokenParams,
  http: HttpClient,
  signer: Signer,
  btcNetwork: btc.Network,
  options?: WorkflowOptions,
): Promise<CreateTokenResult> {
  const progress = new WorkflowProgressReporter("createToken", options?.onProgress);

  const { addresses, quoteParams } = progress.runSync("validateParams", () => {
    const addresses = signer.getAddresses();
    return { addresses, quoteParams: creationQuoteParams(params, addresses) };
  });
  const baseSteps = params.quote ? 3 : 4;
  progress.setTotalSteps(baseSteps);

  const quote =
    params.quote ??
    (await progress.runAsync("requestCreationQuote", () =>
      requestCreationQuote(http, quoteParams),
    ));

  const commitPsbtHex = psbtBase64ToHex(quote.psbtBase64);
  // Everything that can fail without a signature fails here, before the first
  // wallet prompt: a reveal we cannot sign, a commit with no reveal at all, or
  // an envelope that is not the funder's and ours — any of them would pay the
  // fees and lose the message.
  const reveal = verifyCreationQuote(quote, commitPsbtHex, addresses);
  if (reveal) progress.setTotalSteps(baseSteps + 1);
  // Ordinals: a reveal the server signed with a key it then discarded. An
  // inscription is not a Counterparty message, so the source rule does not
  // apply, and it goes through verbatim.
  const ordinalReveal = quote.type === "ordinals" ? quote.revealTxHex : null;

  // `runAsync`: the signer may prompt an external wallet asynchronously. The
  // quote's PSBT is base64 — the only one in this SDK — and every signer here
  // works in hex.
  const signedPsbtHex = await progress.runAsync("signCreationPsbt", async () => {
    const signed = await signer.signPsbtHex(commitPsbtHex, quote.inputsToSign);
    // A reveal spends the quoted commit's txid — the Counterparty one this
    // wallet signs next, as the ordinal one the server signed at quote time —
    // so the wallet must have signed exactly that transaction.
    if (reveal || ordinalReveal !== null) {
      assertCommitUnchanged(commitPsbtHex, signed);
    }
    return signed;
  });

  // Submit the signed PSBT rather than an extracted transaction: `psbt-signer`
  // deliberately does not finalize, and the server does. Finalizing here would
  // duplicate that for no gain, and add a place to accidentally mutate a
  // transaction whose txid the reveal is bound to.
  const submit: SubmitCreationParams = {
    type: params.type,
    psbt: signedPsbtHex,
    identifier: quote.identifier,
  };
  if (reveal) {
    // Verified above against the *unsigned* commit, whose txid is the one the
    // server broadcasts: every commit input is native segwit, and the wallet
    // signed that very transaction.
    const signed = await progress.runAsync("signRevealTx", () =>
      signVerifiedReveal(reveal, signer, btcNetwork),
    );
    submit.revealTxHex = signed.revealTxHex;
  } else if (ordinalReveal !== null) {
    submit.revealTxHex = ordinalReveal;
  }

  let result: CreationResult;
  try {
    result = await progress.runAsync("submitCreation", () =>
      submitCreation(http, submit),
    );
  } catch (err) {
    throw new CreationNotBroadcastError(
      submit,
      commitTxidFromCreationError(err),
      err,
    );
  }

  return { ...result, quote };
}

/**
 * Whether a Counterparty creation quote can be signed and broadcast safely.
 * Runs inside {@link createToken}; a screen that quotes first should call it
 * right after `requestCreationQuote`, so the user learns of an out-of-date
 * server before a confirm modal, not after signing.
 *
 * A reveal is checked against the commit and its funding address (see
 * `verifyReveal`); pass the wallet's `addresses` to also check its envelope is
 * closed by a key this wallet can sign with.
 *
 * Ordinals quotes always pass: their reveal is not a Counterparty message.
 *
 * @throws {PresignedRevealError} the quote carries a reveal without its signing
 * material — pre-signed by the server, which the network has ignored since
 * Counterparty Core v11.5.0.
 * @throws {RevealVerificationError} the reveal does not check out.
 * @throws {Error} the quote's transaction is a taproot *commit* (no inline data
 * output) but no reveal came with it — the server dropped the reveal a
 * v11.5.0+ node returned unsigned. Broadcasting the commit alone would strand
 * its output; or the quote carries signing material but no reveal.
 */
export function assertCreationQuoteSignable(
  quote: Pick<CreationQuote, "type" | "revealTxHex" | "revealSigning">,
  commitPsbtHex: string,
  addresses?: Pick<CreationAddresses, "publicKey" | "xOnlyPubkey">,
): void {
  verifyCreationQuote(quote, commitPsbtHex, addresses);
}

/**
 * {@link assertCreationQuoteSignable}, returning the verified reveal to sign —
 * `null` for an inline issuance and for ordinals.
 */
function verifyCreationQuote(
  quote: Pick<CreationQuote, "type" | "revealTxHex" | "revealSigning">,
  commitPsbtHex: string,
  addresses?: Pick<CreationAddresses, "publicKey" | "xOnlyPubkey">,
): VerifiedReveal | null {
  if (quote.type !== "counterparty") return null;
  const pair = revealToSign("The creation quote", quote.revealTxHex, quote.revealSigning);
  if (!pair) {
    if (!carriesInlineCounterpartyData(commitPsbtHex)) {
      throw new Error(
        "The quoted transaction carries no Counterparty data output and no reveal " +
          "to sign: it is a taproot commit whose reveal the server did not return " +
          "(Counterparty Core ≥ 11.5.0 behind a Horizon Market server that does not " +
          "forward the unsigned reveal). Broadcasting it alone would strand the " +
          "commit output, so nothing was signed. The server must be updated.",
      );
    }
    return null;
  }
  return verifyReveal(pair.revealTxHex, pair.material, {
    ...readRevealCommit(commitPsbtHex),
    expectedKeys: addresses ? signerKeys(addresses) : undefined,
  });
}

/** The subset of a signer a creation needs: its addresses and taproot key. */
export type CreationAddresses = ReturnType<Signer["getAddresses"]>;

/** A 33-byte compressed secp256k1 key in hex — what a P2WPKH address hashes. */
const COMPRESSED_PUBKEY = /^0[23][0-9a-fA-F]{64}$/;

/**
 * Fill in what the wallet knows, then run every check that needs no chain state.
 *
 * Exported because the quote and the transaction have to be composed from the
 * *same* params: a screen that quotes first (to show real fees before asking for
 * a signature) would otherwise hand-roll this, and a second definition of "which
 * address funds a creation" is a divergence waiting to sign something other than
 * what was quoted.
 *
 * @throws when a param cannot produce a usable quote — before spending one.
 */
export function creationQuoteParams(
  params: CreateTokenParams,
  addresses: CreationAddresses,
): CreationQuoteParams {
  // Fund from native segwit by default, for both protocols: it is the cheapest
  // input to spend, and it always exists.
  const address = params.address ?? addresses.p2wpkh;

  let taprootAddress = params.taprootAddress;
  if (params.type === "ordinals" && taprootAddress === undefined) {
    taprootAddress = addresses.p2tr;
    if (!taprootAddress) {
      throw new Error(
        "Ordinal creations require a P2TR address to receive the inscription. " +
          "Pass taprootAddress explicitly or use a signer that provides p2tr.",
      );
    }
  }

  // Funding from taproot: the x-only key — an HDSigner's segwit (BIP84) and
  // taproot (BIP86) keys differ, and the server rejects a key that doesn't match
  // the input rather than ignoring it. A Counterparty creation funded from the
  // signer's own segwit address sends its compressed key too: when the
  // issuance needs a taproot envelope the server closes the envelope with it
  // (Counterparty Core `multisig_pubkey`), which is what lets this wallet sign
  // the reveal. Only a well-formed one, though: a wallet that shares no key
  // must still be able to create an inline issuance, which a malformed
  // `public_key` would turn into a 400. Ordinals never need it — their reveal
  // is not a Counterparty message — and an address the signer does not own has
  // no key to send.
  const publicKey =
    params.publicKey ??
    (isTaprootAddress(address)
      ? addresses.xOnlyPubkey
      : params.type === "counterparty" &&
          address === addresses.p2wpkh &&
          COMPRESSED_PUBKEY.test(addresses.publicKey)
        ? addresses.publicKey
        : undefined);

  const base = {
    name: params.name,
    description: params.description,
    image: params.image,
    thumbnail: params.thumbnail,
    attributes: params.attributes,
    address,
    taprootAddress,
    publicKey,
  };

  const resolved: CreationQuoteParams =
    params.type === "counterparty"
      ? {
          ...base,
          type: "counterparty",
          options: { ...params.options, feeRate: params.satsPerVbyte },
        }
      : { ...base, type: "ordinals", options: { feeRate: params.satsPerVbyte } };

  assertCreationQuoteParams(resolved);
  return resolved;
}
