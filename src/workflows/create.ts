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
  carriesInlineCounterpartyData,
  PresignedRevealError,
  signerKeys,
  signReveal,
  unsignedTxHexFromPsbt,
  verifyReveal,
} from "../crypto/reveal.js";
import * as btc from "bitcoinjs-lib";
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
  /** Only needed when funding from taproot; resolved from the signer otherwise. */
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
 * @throws {PresignedRevealError} when a Counterparty quote carries a reveal
 * pre-signed by an out-of-date server, before anything is signed.
 * @throws {CreationNotBroadcastError} when the submit fails — recover with
 * {@link creationRetry}, never by calling this again.
 */
export async function createToken(
  params: CreateTokenParams,
  http: HttpClient,
  signer: Signer,
  options?: WorkflowOptions,
): Promise<CreateTokenResult> {
  const progress = new WorkflowProgressReporter("createToken", options?.onProgress);

  const quoteParams = progress.runSync("validateParams", () =>
    creationQuoteParams(params, signer.getAddresses()),
  );
  progress.setTotalSteps(params.quote ? 3 : 4);

  const quote =
    params.quote ??
    (await progress.runAsync("requestCreationQuote", () =>
      requestCreationQuote(http, quoteParams),
    ));

  const commitPsbtHex = psbtBase64ToHex(quote.psbtBase64);
  // Refuse, before any signature, a quote whose reveal we cannot sign or whose
  // commit has no reveal at all: either would pay the fees and lose the message.
  assertCreationQuoteSignable(quote, commitPsbtHex);
  const signsReveal = quote.type === "counterparty" && !!quote.revealSigning;
  if (signsReveal) {
    progress.setTotalSteps((params.quote ? 3 : 4) + 1);
    // Check the reveal against the commit and this wallet's keys *before* the
    // commit is signed: an envelope closed by a key we do not hold, or a commit
    // that does not pay the envelope, must not cost the user a wallet prompt.
    // `signReveal` runs the same checks again on the way to the signature.
    verifyReveal(quote.revealTxHex!, quote.revealSigning!, {
      commitTxHex: unsignedTxHexFromPsbt(commitPsbtHex),
      expectedKeys: signerKeys(signer),
    });
  }

  // `runAsync`: the signer may prompt an external wallet asynchronously. The
  // quote's PSBT is base64 — the only one in this SDK — and every signer here
  // works in hex.
  const signedPsbtHex = await progress.runAsync("signCreationPsbt", () =>
    Promise.resolve(signer.signPsbtHex(commitPsbtHex, quote.inputsToSign)),
  );

  // Submit the signed PSBT rather than an extracted transaction: `psbt-signer`
  // deliberately does not finalize, and the server does. Finalizing here would
  // duplicate that for no gain, and add a place to accidentally mutate a
  // transaction whose txid the reveal is bound to.
  const submit: SubmitCreationParams = {
    type: params.type,
    psbt: signedPsbtHex,
    identifier: quote.identifier,
  };
  if (signsReveal) {
    // The reveal binds to the commit's txid, which the signatures cannot move,
    // so it is verified against the *unsigned* commit the quote returned — the
    // same transaction the server will broadcast once it finalizes the PSBT.
    // The PSBT network only governs address encoding; there is none here.
    const signed = await progress.runAsync("signRevealTx", () =>
      signReveal({
        revealTxHex: quote.revealTxHex!,
        material: quote.revealSigning!,
        commitTxHex: unsignedTxHexFromPsbt(commitPsbtHex),
        signer,
        network: btc.networks.bitcoin,
      }),
    );
    submit.revealTxHex = signed.revealTxHex;
  } else if (quote.revealTxHex !== null) {
    // Ordinals: a reveal the server signed with a key it then discarded. An
    // inscription is not a Counterparty message, so the source rule does not
    // apply, and it goes through verbatim.
    submit.revealTxHex = quote.revealTxHex;
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
 * Ordinals quotes always pass: their reveal is not a Counterparty message.
 *
 * @throws {PresignedRevealError} the quote carries a reveal without its signing
 * material — pre-signed by the server, which the network has ignored since
 * Counterparty Core v11.5.0.
 * @throws {Error} the quote's transaction is a taproot *commit* (no inline data
 * output) but no reveal came with it — the server dropped the reveal a
 * v11.5.0+ node returned unsigned. Broadcasting the commit alone would strand
 * its output; or the quote carries signing material but no reveal.
 */
export function assertCreationQuoteSignable(
  quote: Pick<CreationQuote, "type" | "revealTxHex" | "revealSigning">,
  commitPsbtHex: string,
): void {
  if (quote.type !== "counterparty") return;
  if (quote.revealTxHex !== null && !quote.revealSigning) {
    throw new PresignedRevealError("The creation quote");
  }
  if (quote.revealSigning && quote.revealTxHex === null) {
    throw new Error(
      "The creation quote carries reveal signing material but no reveal transaction.",
    );
  }
  if (quote.revealTxHex === null && !carriesInlineCounterpartyData(commitPsbtHex)) {
    throw new Error(
      "The quoted transaction carries no Counterparty data output and no reveal " +
        "to sign: it is a taproot commit whose reveal the server did not return " +
        "(Counterparty Core ≥ 11.5.0 behind a Horizon Market server that does not " +
        "forward the unsigned reveal). Broadcasting it alone would strand the " +
        "commit output, so nothing was signed. The server must be updated.",
    );
  }
}

/** The subset of a signer a creation needs: its addresses and taproot key. */
export type CreationAddresses = ReturnType<Signer["getAddresses"]>;

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
  // input to spend, it always exists, and it keeps `public_key` — which the
  // server validates against the input's script — out of the request entirely.
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
  // the reveal. Ordinals never need it — their reveal is not a Counterparty
  // message — and an address the signer does not own has no key to send.
  const publicKey =
    params.publicKey ??
    (isTaprootAddress(address)
      ? addresses.xOnlyPubkey
      : params.type === "counterparty" && address === addresses.p2wpkh
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
