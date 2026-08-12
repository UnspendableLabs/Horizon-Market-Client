import type { HttpClient } from "../api/http.js";
import {
  commitTxidFromCreationError,
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
 * `commitTxid` is set only when the commit reached the network but its reveal did
 * not. A `null` means nothing was broadcast.
 */
export class CreationNotBroadcastError extends Error {
  readonly submit: SubmitCreationParams;
  readonly commitTxid: string | null;
  override readonly cause?: unknown;

  constructor(
    submit: SubmitCreationParams,
    commitTxid: string | null,
    cause: unknown,
  ) {
    super(
      commitTxid
        ? "Your transaction is on-chain, but the reveal that completes it was " +
            `rejected (commit ${commitTxid}). Retry re-sends the same signed ` +
            "transaction: nothing is signed or paid again."
        : "The signed transaction could not be submitted. Retry re-sends the " +
            "same one — nothing is signed or paid again.",
    );
    this.name = "CreationNotBroadcastError";
    this.submit = submit;
    this.commitTxid = commitTxid;
    this.cause = cause;
  }
}

/** Everything needed to safely recover a {@link CreationNotBroadcastError}. */
export interface CreationRetry {
  /** Re-POST this via `submitCreation` — do not re-run `createToken`. */
  submit: SubmitCreationParams;
  commitTxid: string | null;
}

/**
 * Recovery info from a caught error, or `null` when it is not a
 * {@link CreationNotBroadcastError}.
 */
export function creationRetry(error: unknown): CreationRetry | null {
  return error instanceof CreationNotBroadcastError
    ? { submit: error.submit, commitTxid: error.commitTxid }
    : null;
}

/**
 * createToken — quote → sign → submit.
 *
 * 1. Resolve the funding / receiving addresses from the signer and validate.
 * 2. Request a creation quote (skipped when `params.quote` is supplied).
 * 3. Sign the quote's PSBT, unchanged apart from its witnesses.
 * 4. Submit it, together with the pre-signed reveal when the quote carried one.
 *
 * @throws {CreationNotBroadcastError} when step 4 fails — recover with
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
    resolveCreationQuoteParams(params, signer),
  );
  progress.setTotalSteps(params.quote ? 3 : 4);

  const quote =
    params.quote ??
    (await progress.runAsync("requestCreationQuote", () =>
      requestCreationQuote(http, quoteParams),
    ));

  // `runAsync`: the signer may prompt an external wallet asynchronously. The
  // quote's PSBT is base64 — the only one in this SDK — and every signer here
  // works in hex.
  const signedPsbtHex = await progress.runAsync("signCreationPsbt", () =>
    Promise.resolve(
      signer.signPsbtHex(psbtBase64ToHex(quote.psbtBase64), quote.inputsToSign),
    ),
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
  if (quote.revealTxHex !== null) submit.revealTxHex = quote.revealTxHex;

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

/** Fill in what the signer knows, then run every check that needs no chain state. */
function resolveCreationQuoteParams(
  params: CreateTokenParams,
  signer: Signer,
): CreationQuoteParams {
  const addresses = signer.getAddresses();

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

  // Only when funding from taproot, and then the x-only key: an HDSigner's
  // segwit (BIP84) and taproot (BIP86) keys differ, and the server rejects a
  // key that doesn't match the input rather than ignoring it.
  const publicKey =
    params.publicKey ??
    (isTaprootAddress(address) ? addresses.xOnlyPubkey : undefined);

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
