import {
  HttpClient,
  HorizonMarketApiError,
  appendFilePart,
  readErrorMessage,
} from "./http.js";
import type { RequestOptions } from "../types/index.js";
import type { RevealSigningMaterial } from "../crypto/reveal.js";

/**
 * Token creation — `/api/creations/*`.
 *
 * One request shape for every protocol: the same body composes a Counterparty
 * issuance or an ordinal inscription, and the quote answers the same fields
 * whichever branch produced it, so a client keeps a single code path.
 *
 * The flow is `quote → sign → submit`, the same two-step as `sell-quotes` /
 * `buy-quotes`, with two differences worth knowing before calling any of it:
 *
 * - **`/quotes` and `/media` are session-gated** (`client.signInWithWallet()`
 *   first); `POST /api/creations` is not, which is what lets a submit still go
 *   through after a session expires mid-flow.
 * - **There is no `preview` quote.** Composing pins a JSON descriptor to IPFS
 *   (Counterparty) or pulls up to 350 kB of media through a gateway (ordinals),
 *   so a quote is a real, metered request — take one per attempt rather than one
 *   per keystroke.
 *
 * `image` is always an `ipfs://` URI. That is what makes one field mean the same
 * thing on both chains: Counterparty stores it inside the pinned descriptor, an
 * ordinal inscribes the bytes behind it. {@link uploadCreationMedia} pins a file
 * and hands back the URI for callers without their own pinning.
 */

// ─── Wire types (snake_case, internal only) ──────────────────────────────────

interface WireCreationQuoteBody {
  type: CreatableType;
  name: string;
  description?: string;
  image: string;
  thumbnail?: string;
  attributes?: Record<string, string>;
  address: string;
  taproot_address?: string;
  public_key?: string;
  options?: WireCreationOptions;
}

interface WireCreationOptions {
  quantity?: string | number;
  divisible?: boolean;
  lock?: boolean;
  fee_rate?: number;
}

interface WireCreationQuote {
  type: CreationType;
  identifier: string;
  psbt: string;
  inputs_to_sign: number[];
  reveal_tx_hex: string | null;
  estimated_fee_sats: number;
  total_cost_sats: number;
  // Counterparty taproot envelope only — Counterparty Core's own result keys,
  // passed through by the server. Present together or not at all.
  envelope_script?: string | null;
  reveal_control_block?: string | null;
  reveal_pubkey?: string | null;
  reveal_lock_scripts?: string[] | null;
  reveal_inputs_values?: number[] | null;
}

interface WireCreationSubmitBody {
  type: CreationType;
  tx_hex?: string;
  psbt?: string;
  reveal_tx_hex?: string;
  identifier?: string;
}

interface WireCreationResult {
  type: CreationType;
  identifier: string | null;
  txid: string;
  reveal_txid: string | null;
  inscription_id: string | null;
}

interface WireCreationMedia {
  ipfs_url: string;
  cid: string;
  thumbnail_ipfs_url: string | null;
  content_type: string;
  size: number;
}

// ─── Domain types ────────────────────────────────────────────────────────────

/**
 * Protocols the creations API speaks. `"kontor"` is reserved — the server
 * answers `501` for it on signet and `404` everywhere else, so the branch stays
 * invisible off signet — and is therefore not creatable through this SDK.
 */
export type CreationType = "counterparty" | "ordinals" | "kontor";

/** The protocols a quote can actually be requested for. */
export type CreatableType = Exclude<CreationType, "kontor">;

/** Free-form metadata written into the descriptor / inscribed as CBOR. */
export type CreationAttributes = Record<string, string>;

export interface CounterpartyCreationOptions {
  /**
   * Human-readable supply — the server scales it by 1e8 when `divisible`.
   * Defaults to `1`. A non-divisible asset must be a whole number.
   */
  quantity?: string | number;
  /** 8 decimal places. Defaults to `false`. */
  divisible?: boolean;
  /**
   * Lock the supply against further issuance. Defaults to `true`.
   *
   * Note the wire key is `lock`, not `locked`.
   */
  lock?: boolean;
  /** sat/vB, 1–2000. Rides *inside* `options`, unlike `sats_per_vbyte` elsewhere. */
  feeRate?: number;
}

export interface OrdinalsCreationOptions {
  /**
   * sat/vB, 1–2000. Applies to the commit *and* the reveal — and the reveal is
   * signed once, at quote time, so it can never be fee-bumped afterwards.
   */
  feeRate?: number;
}

interface CreationQuoteParamsBase {
  /** Counterparty asset name, ordinal title, or Kontor `nft_id`. 1–250 chars. */
  name: string;
  /** Up to 2000 chars. */
  description?: string;
  /** `ipfs://<cid>` (or `ipfs:<cid>`) — required. Gateway URLs are rejected. */
  image: string;
  /** `ipfs://` thumbnail. Counterparty only; ordinals ignores it. */
  thumbnail?: string;
  /** At most 32 entries, at most 4096 bytes once JSON-serialized. */
  attributes?: CreationAttributes;
  /** The address that funds the transaction and receives the asset. */
  address: string;
  /** P2TR address that receives the inscription. Required for ordinals. */
  taprootAddress?: string;
  /**
   * Hex public key (x-only or compressed) of `address`. Required whenever
   * `address` is taproot — it becomes each taproot input's `tapInternalKey`, and
   * the server rejects a key that doesn't match rather than ignoring it.
   *
   * For a Counterparty creation send it for a native-segwit `address` too
   * (compressed): when the issuance needs a taproot envelope the server closes
   * the envelope with this key (Counterparty Core `multisig_pubkey`), so the
   * wallet can sign the reveal. Without it the node looks the key up in the
   * address's spending history and fails for an address that never spent.
   */
  publicKey?: string;
}

export interface CounterpartyCreationQuoteParams
  extends CreationQuoteParamsBase {
  type: "counterparty";
  options?: CounterpartyCreationOptions;
}

export interface OrdinalsCreationQuoteParams extends CreationQuoteParamsBase {
  type: "ordinals";
  options?: OrdinalsCreationOptions;
}

export type CreationQuoteParams =
  | CounterpartyCreationQuoteParams
  | OrdinalsCreationQuoteParams;

export interface CreationQuote {
  type: CreationType;
  /** Counterparty: the asset name. Ordinals: `<revealTxid>i0`, known in advance. */
  identifier: string;
  /**
   * **Base64** — the only base64 PSBT in this SDK, where every signer takes hex.
   * The name is the guardrail: run it through `psbtBase64ToHex` before signing.
   *
   * Ordinals: this is the *commit*. Do not reorder, add or remove inputs or
   * outputs — the reveal is bound to this transaction's txid.
   */
  psbtBase64: string;
  /** Every input index; pass straight to `signer.signPsbtHex`. */
  inputsToSign: number[];
  /**
   * Ordinals: always set — a reveal pre-signed with a key the server discards
   * (an ordinal inscription is not a Counterparty message, so the source
   * signature rule does not apply). Echo it **verbatim** on submit; a commit
   * broadcast without its reveal strands the funds at a script nothing can
   * unlock.
   *
   * Counterparty: set only when the issuance falls back to a taproot envelope
   * (a description too long for `OP_RETURN`), and then **unsigned**, with
   * {@link revealSigning} carrying what the wallet needs to sign it — since
   * Counterparty Core v11.5.0 the node no longer signs reveals, because the
   * network attributes a reveal to the funding address only when that address
   * signed it. `createToken` signs it and submits the signed hex. A Counterparty
   * reveal *without* `revealSigning` comes from an out-of-date server and would
   * be ignored by the network: `createToken` refuses it.
   */
  revealTxHex: string | null;
  /**
   * Counterparty taproot envelope only: the envelope leaf, control block, the
   * x-only key that closes the leaf (a key of `address`) and the commit output
   * the reveal spends. `null` for ordinals and for inline-encoded issuances.
   * See `signReveal` for how it is consumed.
   */
  revealSigning: RevealSigningMaterial | null;
  estimatedFeeSats: number;
  /**
   * BTC only. Ordinals includes the 546-sat postage; Counterparty does **not**
   * include the XCP name-registration fee (0.5 XCP named, 0.25 subasset, free
   * for numeric `A…` names), which is charged in XCP and checked at compose time.
   */
  totalCostSats: number;
}

export interface SubmitCreationParams {
  type: CreationType;
  /** Signed, finalized raw transaction hex. Mutually exclusive with `psbt`. */
  txHex?: string;
  /** Signed PSBT, hex or base64 — the server finalizes and extracts it. */
  psbt?: string;
  /**
   * Ordinals: the quote's `revealTxHex`, unchanged. Counterparty taproot
   * envelope: the reveal **signed by the wallet** (`signReveal`). The server
   * broadcasts the commit, then this.
   */
  revealTxHex?: string;
  /** Echoed back on the result for Counterparty; ignored for ordinals. */
  identifier?: string;
}

export interface CreationResult {
  type: CreationType;
  identifier: string | null;
  /** The issuance (Counterparty) or commit (ordinals) txid. */
  txid: string;
  revealTxid: string | null;
  /** `<revealTxid>i0` for ordinals, `null` otherwise. */
  inscriptionId: string | null;
}

/**
 * A `Blob`/`File`, or a React Native picker result. Structurally the same as
 * `AvatarUpload`, named apart because this endpoint's allowlist is much wider.
 *
 * On Expo, prefer the blob: `expo/fetch` cannot encode the `{ uri }` descriptor.
 */
export type CreationMediaUpload =
  | Blob
  | { uri: string; name?: string; type?: string };

export interface UploadCreationMediaOptions extends RequestOptions {
  /** Also pin a downscaled copy (`?thumbnail=true`). Best-effort server-side. */
  thumbnail?: boolean;
}

export interface CreationMediaResult {
  /** `ipfs://<cid>` — hand this straight to a quote's `image`. */
  ipfsUrl: string;
  cid: string;
  thumbnailIpfsUrl: string | null;
  /** Sniffed server-side; may differ from the type the caller declared. */
  contentType: string;
  size: number;
}

// ─── Server limits, so callers stop guessing ─────────────────────────────────

export const MAX_CREATION_NAME_LENGTH = 250;
export const MAX_CREATION_DESCRIPTION_LENGTH = 2000;
export const MAX_CREATION_ATTRIBUTES = 32;
export const MAX_CREATION_ATTRIBUTE_BYTES = 4096;
/** `/api/creations/media` refuses anything larger. */
export const MAX_CREATION_MEDIA_BYTES = 10 * 1024 * 1024;
/**
 * An ordinals quote refuses media above this once it has *fetched* the bytes —
 * so a 4 MB image uploads fine and then fails at quote time.
 */
export const MAX_INSCRIPTION_BYTES = 350_000;
/** Content types `/api/creations/media` accepts. */
export const CREATION_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "application/json",
  "text/plain",
] as const;

// ─── Requests ────────────────────────────────────────────────────────────────

/**
 * Marshal the protocol-specific `options`, or `undefined` when nothing was set.
 *
 * Every key is server-defaulted, so an untouched advanced section sends no
 * `options` at all — the shape the server's `.default({})` was written for.
 */
function marshalOptions(
  params: CreationQuoteParams,
): WireCreationOptions | undefined {
  const options: WireCreationOptions = {};
  if (params.type === "counterparty") {
    const source = params.options;
    // The supply goes over the wire human-readable: the server scales it by 1e8
    // itself when the asset is divisible.
    if (source?.quantity !== undefined) options.quantity = source.quantity;
    if (source?.divisible !== undefined) options.divisible = source.divisible;
    if (source?.lock !== undefined) options.lock = source.lock;
    if (source?.feeRate !== undefined) options.fee_rate = source.feeRate;
  } else if (params.options?.feeRate !== undefined) {
    options.fee_rate = params.options.feeRate;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * Counterparty Core's reveal result keys → {@link RevealSigningMaterial}, or
 * `null` when none is present. A partial set is a malformed quote, not a
 * variant: signing with a guessed field would produce a reveal the network
 * ignores, so it is refused here rather than deep inside the signer.
 */
export function mapRevealSigning(wire: {
  envelope_script?: string | null;
  reveal_control_block?: string | null;
  reveal_pubkey?: string | null;
  reveal_lock_scripts?: string[] | null;
  reveal_inputs_values?: number[] | null;
}): RevealSigningMaterial | null {
  const fields = [
    wire.envelope_script,
    wire.reveal_control_block,
    wire.reveal_pubkey,
    wire.reveal_lock_scripts?.[0],
    wire.reveal_inputs_values?.[0],
  ];
  const present = fields.filter((f) => f !== undefined && f !== null);
  if (present.length === 0) return null;
  if (
    present.length !== fields.length ||
    typeof wire.envelope_script !== "string" ||
    typeof wire.reveal_control_block !== "string" ||
    typeof wire.reveal_pubkey !== "string" ||
    typeof wire.reveal_lock_scripts?.[0] !== "string" ||
    typeof wire.reveal_inputs_values?.[0] !== "number"
  ) {
    throw new HorizonMarketApiError(
      502,
      "The quote carries an incomplete reveal signing material (envelope_script, " +
        "reveal_control_block, reveal_pubkey, reveal_lock_scripts, " +
        "reveal_inputs_values must come together).",
    );
  }
  return {
    envelopeScript: wire.envelope_script,
    controlBlock: wire.reveal_control_block,
    pubkey: wire.reveal_pubkey,
    lockScript: wire.reveal_lock_scripts[0],
    inputValue: wire.reveal_inputs_values[0],
  };
}

function mapCreationQuote(wire: WireCreationQuote): CreationQuote {
  return {
    type: wire.type,
    identifier: wire.identifier,
    psbtBase64: wire.psbt,
    inputsToSign: wire.inputs_to_sign,
    revealTxHex: wire.reveal_tx_hex,
    revealSigning: mapRevealSigning(wire),
    estimatedFeeSats: wire.estimated_fee_sats,
    totalCostSats: wire.total_cost_sats,
  };
}

/**
 * POST /api/creations/quotes — compose the unsigned creation transaction.
 *
 * **Session-gated** and **metered**: composing pins a descriptor (Counterparty)
 * or fetches the media (ordinals) before it can answer, and nothing server-side
 * deduplicates two identical requests. Guard the call site against a double tap
 * rather than quoting on every edit.
 *
 * @throws {HorizonMarketApiError} `400` when the name is taken, the parent
 * subasset is missing or unowned, the address has no spendable UTXOs, or the
 * media is unreachable / over 350 kB; `401` without a session; `404`/`501` for
 * `"kontor"`.
 */
export async function requestCreationQuote(
  http: HttpClient,
  params: CreationQuoteParams,
  options?: RequestOptions,
): Promise<CreationQuote> {
  const body: WireCreationQuoteBody = {
    type: params.type,
    name: params.name,
    image: params.image,
    address: params.address,
  };

  if (params.description !== undefined) body.description = params.description;
  if (params.thumbnail !== undefined) body.thumbnail = params.thumbnail;
  if (params.attributes !== undefined) body.attributes = params.attributes;
  if (params.taprootAddress !== undefined)
    body.taproot_address = params.taprootAddress;
  if (params.publicKey !== undefined) body.public_key = params.publicKey;

  const wireOptions = marshalOptions(params);
  if (wireOptions !== undefined) body.options = wireOptions;

  const wire = await http.request<WireCreationQuote>(
    "POST",
    "/api/creations/quotes",
    body,
    options?.signal,
  );
  return mapCreationQuote(wire);
}

/**
 * POST /api/creations — broadcast a signed creation. Unauthenticated.
 *
 * Exactly one of `txHex` / `psbt`. The transaction must be the quote's, with
 * only its witnesses filled in: a segwit txid commits to inputs and outputs
 * alone, so signing cannot move it, but reordering or re-selecting anything can
 * — and the server verifies the reveal against that txid and answers `400`
 * **before** broadcasting anything rather than stranding the commit.
 *
 * Broadcasting is idempotent, so re-posting an identical body after a failure is
 * safe — and for anything but a `4xx` it is the *only* correct recovery. See
 * `CreationNotBroadcastError` in `workflows/create.ts`, and
 * {@link creationSubmitMayHaveBroadcast} for which failures those are.
 *
 * @throws {HorizonMarketApiError} `400` (malformed, unsigned, mismatched reveal,
 * or the relay rejecting the transaction — nothing broadcast) or `502` (the
 * commit is on-chain but its reveal was rejected — the message usually carries
 * the commit txid — or the node was unreachable). A `502` that names no txid
 * reads as the latter, but that is a claim about wording, not a guarantee:
 * treat every `502` as possibly broadcast.
 */
export async function submitCreation(
  http: HttpClient,
  params: SubmitCreationParams,
  options?: RequestOptions,
): Promise<CreationResult> {
  const body: WireCreationSubmitBody = { type: params.type };
  if (params.txHex !== undefined) body.tx_hex = params.txHex;
  if (params.psbt !== undefined) body.psbt = params.psbt;
  if (params.revealTxHex !== undefined) body.reveal_tx_hex = params.revealTxHex;
  if (params.identifier !== undefined) body.identifier = params.identifier;

  const wire = await http.request<WireCreationResult>(
    "POST",
    "/api/creations",
    body,
    options?.signal,
  );
  return {
    type: wire.type,
    identifier: wire.identifier,
    txid: wire.txid,
    revealTxid: wire.reveal_txid,
    inscriptionId: wire.inscription_id,
  };
}

/**
 * POST /api/creations/media — pin a file to IPFS and get its `ipfs://` URI.
 *
 * **Session-gated.** Accepts a `Blob`/`File` or a React Native
 * `{ uri, name, type }` picker result; the `Content-Type` header is left to
 * `fetch`, which fills in the multipart boundary.
 *
 * Under Expo (SDK 54+), whose `fetch` sends blobs only, pass a blob — a
 * `new File(uri)` from `expo-file-system` — rather than the descriptor.
 *
 * @throws {HorizonMarketApiError} `400` when the file is missing, over 10 MB, or
 * its type is outside {@link CREATION_MEDIA_TYPES} (declared *or* sniffed);
 * `401` without a session; `500` when pinning fails.
 */
export async function uploadCreationMedia(
  http: HttpClient,
  file: CreationMediaUpload,
  options?: UploadCreationMediaOptions,
): Promise<CreationMediaResult> {
  const form = new FormData();
  appendFilePart(form, "file", file, {
    name: "media",
    type: "application/octet-stream",
  });

  const path = options?.thumbnail
    ? "/api/creations/media?thumbnail=true"
    : "/api/creations/media";

  const response = await http.fetchRaw("POST", path, {
    headers: { Accept: "application/json" },
    body: form,
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new HorizonMarketApiError(
      response.status,
      await readErrorMessage(response),
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: WireCreationMedia;
  } | null;
  const media = payload?.data;
  if (!media?.ipfs_url) {
    throw new HorizonMarketApiError(
      response.status,
      "Media upload returned no ipfs_url",
    );
  }
  return {
    ipfsUrl: media.ipfs_url,
    cid: media.cid,
    thumbnailIpfsUrl: media.thumbnail_ipfs_url ?? null,
    contentType: media.content_type,
    size: media.size,
  };
}

/**
 * The commit txid carried in a `502` "…broadcast as `<txid>`, but its reveal was
 * rejected…" message, or `null`.
 *
 * **For display only.** The creations API answers flat `{ error: string }` with
 * no machine-readable code, so this is the one place that reads a message — and
 * a regex over prose is fine for naming a transaction the user can go look up,
 * and far too weak to decide whether one exists. A `null` here means "no txid to
 * show", *not* "nothing was broadcast"; {@link creationSubmitMayHaveBroadcast}
 * is the question that gates recovery.
 */
export function commitTxidFromCreationError(error: unknown): string | null {
  if (!(error instanceof HorizonMarketApiError) || error.status !== 502) {
    return null;
  }
  const match = /\b[0-9a-f]{64}\b/i.exec(error.error);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Whether a failed {@link submitCreation} may have put a transaction on the
 * network — the question that decides whether re-composing is safe.
 *
 * Deliberately **not** derived from {@link commitTxidFromCreationError}. That one
 * reads a txid out of prose, and the two failure modes are wildly asymmetric: a
 * false "nothing was broadcast" lets the caller compose a *second* transaction,
 * which for an ordinal strands the first commit's funds permanently, while a
 * false "something was broadcast" only costs a replay that the server answers
 * idempotently. So the parse decides what to *show*, never what is *safe*.
 *
 * The one thing that positively means nothing was broadcast is the server
 * answering `4xx`: it validates the PSBT, the reveal and their binding before it
 * touches a node, so a rejection there happens with nothing sent. Everything
 * else — a `5xx`, a timeout, a socket closed mid-flight — leaves us unable to
 * say, and "unable to say" has to read as "it is out there".
 */
export function creationSubmitMayHaveBroadcast(error: unknown): boolean {
  if (error instanceof HorizonMarketApiError) {
    return !(error.status >= 400 && error.status < 500);
  }
  return true;
}
