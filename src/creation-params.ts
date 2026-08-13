import { randomBytes } from "@noble/hashes/utils.js";
import { isTaprootAddress } from "./sell-params.js";
import {
  MAX_CREATION_ATTRIBUTES,
  MAX_CREATION_ATTRIBUTE_BYTES,
  MAX_CREATION_DESCRIPTION_LENGTH,
  MAX_CREATION_NAME_LENGTH,
  type CreationAttributes,
  type CreationQuoteParams,
} from "./api/creations.js";

/**
 * Client-side guards for the creations API.
 *
 * Worth mirroring here rather than leaving to the server, because a creation
 * quote is **metered**: it pins a JSON descriptor (Counterparty) or pulls the
 * media through a gateway (ordinals) before it can fail. A name typo should cost
 * a form hint, not a pin.
 *
 * Each rule comes in two shapes — `validateX` returns a message for a live form
 * hint, `assertX` throws for the workflow — so both surfaces say the same thing.
 *
 * What is deliberately *not* checked here: whether the name is already issued,
 * whether a subasset's parent exists and is owned, funding sufficiency, and the
 * CID's own shape (mirroring the server's five multibase patterns would risk
 * rejecting a CID it accepts, and in practice `image` comes from our own
 * `uploadCreationMedia`). Those need chain or network state; they are the
 * server's 400 to give.
 */

// ─── Counterparty asset names ────────────────────────────────────────────────

const NAMED_PATTERN = /^[B-Z][A-Z]{3,11}$/;
const NUMERIC_PATTERN = /^A(\d+)$/;
const SUBASSET_PATTERN = /^([B-Z][A-Z]{3,11}|A\d+)\.([a-zA-Z0-9.\-_@!]+)$/;

/** Smallest valid numeric asset name (`26**12 + 1`). */
export const COUNTERPARTY_NUMERIC_MIN = 95428956661682177n;
/** Largest valid numeric asset name (`2**64 - 1`). */
export const COUNTERPARTY_NUMERIC_MAX = 18446744073709551615n;

function validateNumericName(digits: string): string | null {
  const value = BigInt(digits);
  if (value < COUNTERPARTY_NUMERIC_MIN || value > COUNTERPARTY_NUMERIC_MAX) {
    return `Numeric asset names must be between A${COUNTERPARTY_NUMERIC_MIN} and A${COUNTERPARTY_NUMERIC_MAX}.`;
  }
  return null;
}

/**
 * Why `name` is not a valid Counterparty asset name, or `null` when it is.
 *
 * Three forms: a named asset (4–12 uppercase letters, not starting with `A`), a
 * numeric `A<n>` name in the range above, or `PARENT.child` where the parent is
 * either of the first two.
 */
export function validateCounterpartyAssetName(name: string): string | null {
  if (!name) return "Enter an asset name.";
  if (name.length > MAX_CREATION_NAME_LENGTH) {
    return `Asset names are at most ${MAX_CREATION_NAME_LENGTH} characters.`;
  }

  const subasset = SUBASSET_PATTERN.exec(name);
  if (subasset) {
    const parentNumeric = NUMERIC_PATTERN.exec(subasset[1] as string);
    return parentNumeric ? validateNumericName(parentNumeric[1] as string) : null;
  }

  const numeric = NUMERIC_PATTERN.exec(name);
  if (numeric) return validateNumericName(numeric[1] as string);

  if (NAMED_PATTERN.test(name)) return null;

  if (name.includes(".")) {
    return "Subasset names look like PARENT.child, where child may use letters, digits and . - _ @ !";
  }
  return "Named assets are 4–12 uppercase letters and cannot start with A (use a numeric A… name instead).";
}

export function assertCounterpartyAssetName(name: string): void {
  const error = validateCounterpartyAssetName(name);
  if (error) throw new Error(error);
}

/** The parent of a subasset name, or `null` when the name is not a subasset. */
export function parentAssetOf(name: string): string | null {
  const match = SUBASSET_PATTERN.exec(name);
  return match ? (match[1] as string) : null;
}

/** True for a numeric `A<n>` name — the one form Counterparty registers for free. */
export function isNumericAssetName(name: string): boolean {
  const match = NUMERIC_PATTERN.exec(name);
  return match !== null && validateNumericName(match[1] as string) === null;
}

/**
 * XCP Counterparty charges to register `name`: 0.5 for a named asset, 0.25 for a
 * subasset, 0 for a numeric one.
 *
 * An empty name costs **nothing**, rather than the 0.5 its shape would otherwise
 * imply: a form has no name to price before one is typed, and quoting a fee for
 * it means warning about a balance against a registration nobody has asked for.
 *
 * This is **not** part of a quote's `totalCostSats`, which is BTC only — the
 * Counterparty node refuses at compose time when the balance is short.
 */
export function xcpNameFee(name: string): number {
  if (!name.trim()) return 0;
  const parent = parentAssetOf(name);
  if (parent !== null) return 0.25;
  return isNumericAssetName(name) ? 0 : 0.5;
}

/**
 * A random numeric asset name — the one form Counterparty registers for **free**,
 * which is what makes it the way to create without holding XCP.
 *
 * Uniform over the whole valid range, and 64 bits wide, so a collision with an
 * existing issuance is not a case worth handling: the server's `400` covers the
 * remainder. 32 random bytes are drawn for a ~64-bit range, which puts the
 * modulo bias below 2⁻¹⁹² — cheaper than a rejection loop and just as uniform in
 * any sense that matters here.
 */
export function randomNumericAssetName(): string {
  const span = COUNTERPARTY_NUMERIC_MAX - COUNTERPARTY_NUMERIC_MIN + 1n;
  let draw = 0n;
  for (const byte of randomBytes(32)) draw = (draw << 8n) | BigInt(byte);
  return `A${(draw % span) + COUNTERPARTY_NUMERIC_MIN}`;
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/** Native segwit (`bc1q…` / `tb1q…`), the default funding address kind. */
export function isNativeSegwitAddress(address: string): boolean {
  return address.startsWith("bc1q") || address.startsWith("tb1q");
}

/** Legacy P2PKH (`1…` / `m…` / `n…`). */
export function isP2pkhAddress(address: string): boolean {
  return /^[1mn]/.test(address);
}

/**
 * Address kinds the creations API can fund from. P2SH-wrapped segwit (`3…` /
 * `2…`) is excluded: the server hydrates no `redeemScript`, so it 400s.
 */
export function isFundableCreationAddress(address: string): boolean {
  return (
    isNativeSegwitAddress(address) ||
    isTaprootAddress(address) ||
    isP2pkhAddress(address)
  );
}

const PUBKEY_PATTERN = /^(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{66})$/;

/**
 * A taproot funding address needs its public key: it becomes each taproot
 * input's `tapInternalKey`, and the server checks it against the input's script
 * rather than ignoring a wrong one.
 */
export function assertCreationPubkey(
  address: string,
  publicKey: string | undefined,
): void {
  if (!isTaprootAddress(address)) return;
  if (!publicKey) {
    throw new Error(
      "A P2TR funding address requires its public key (x-only or compressed hex). " +
        "Pass publicKey explicitly or fund from the signer's native segwit address.",
    );
  }
  if (!PUBKEY_PATTERN.test(publicKey)) {
    throw new Error(
      "publicKey must be 64 (x-only) or 66 (compressed) hex characters.",
    );
  }
}

// ─── Media URIs ──────────────────────────────────────────────────────────────

// The character class after the optional `//` is what stops a bare "ipfs://"
// from passing — `\S+` would happily match the slashes themselves.
const IPFS_URI_PATTERN = /^ipfs:(?:\/\/)?[^/\s]\S*$/i;

/**
 * True for `ipfs://<cid>` or `ipfs:<cid>`. The CID itself is the server's to
 * validate; the mistake this catches is a gateway `https://…/ipfs/…` URL, which
 * the API rejects.
 */
export function isIpfsUri(value: string): boolean {
  return IPFS_URI_PATTERN.test(value.trim());
}

export function assertIpfsUri(value: string, field: string): void {
  if (!isIpfsUri(value)) {
    throw new Error(
      `${field} must be an ipfs:// URI (a gateway https:// URL is rejected). ` +
        "Upload the file with uploadCreationMedia to get one.",
    );
  }
}

// ─── Attributes ──────────────────────────────────────────────────────────────

/** Why these attributes are unusable, or `null`. */
export function validateCreationAttributes(
  attributes: CreationAttributes,
): string | null {
  const keys = Object.keys(attributes);
  if (keys.length > MAX_CREATION_ATTRIBUTES) {
    return `At most ${MAX_CREATION_ATTRIBUTES} attributes.`;
  }
  if (keys.some((key) => key.length === 0)) {
    return "Every attribute needs a name.";
  }
  // The server's limit is on the serialized bytes, not the character count —
  // a value of emoji costs four times what its length suggests.
  const bytes = new TextEncoder().encode(JSON.stringify(attributes)).length;
  if (bytes > MAX_CREATION_ATTRIBUTE_BYTES) {
    return `Attributes are too large (${bytes} of ${MAX_CREATION_ATTRIBUTE_BYTES} bytes).`;
  }
  return null;
}

export function assertCreationAttributes(attributes: CreationAttributes): void {
  const error = validateCreationAttributes(attributes);
  if (error) throw new Error(error);
}

// ─── The umbrella ────────────────────────────────────────────────────────────

/**
 * Everything checkable without chain state, in the order a form would surface
 * it. Called by `createToken` before it spends a quote.
 */
export function assertCreationQuoteParams(params: CreationQuoteParams): void {
  if (params.type === "counterparty") {
    assertCounterpartyAssetName(params.name);
  } else if (!params.name || params.name.length > MAX_CREATION_NAME_LENGTH) {
    throw new Error(
      `Enter a name of at most ${MAX_CREATION_NAME_LENGTH} characters.`,
    );
  }

  if (
    params.description !== undefined &&
    params.description.length > MAX_CREATION_DESCRIPTION_LENGTH
  ) {
    throw new Error(
      `Descriptions are at most ${MAX_CREATION_DESCRIPTION_LENGTH} characters.`,
    );
  }

  assertIpfsUri(params.image, "image");
  if (params.thumbnail !== undefined) assertIpfsUri(params.thumbnail, "thumbnail");
  if (params.attributes !== undefined) assertCreationAttributes(params.attributes);

  if (!isFundableCreationAddress(params.address)) {
    throw new Error(
      "address must be native segwit (bc1q…/tb1q…), taproot (bc1p…/tb1p…) or legacy (1…/m…/n…). " +
        "P2SH-wrapped segwit (3…/2…) cannot fund a creation.",
    );
  }
  assertCreationPubkey(params.address, params.publicKey);

  if (params.type === "ordinals") {
    if (!params.taprootAddress) {
      throw new Error(
        "Ordinal creations require a P2TR address to receive the inscription.",
      );
    }
    if (!isTaprootAddress(params.taprootAddress)) {
      throw new Error("taprootAddress must be a P2TR address (bc1p… or tb1p…).");
    }
    if (isP2pkhAddress(params.address)) {
      throw new Error(
        "Ordinal creations cannot be funded from a legacy address — use native segwit or taproot.",
      );
    }
  }

  if (params.type === "counterparty" && params.options !== undefined) {
    assertCreationQuantity(params.options.quantity, params.options.divisible);
  }

  const feeRate = params.options?.feeRate;
  if (feeRate !== undefined && (feeRate < 1 || feeRate > 2000)) {
    throw new Error("feeRate must be between 1 and 2000 sat/vB.");
  }
}

/** Why this supply is unusable for a Counterparty issuance, or `null`. */
export function validateCreationQuantity(
  quantity: string | number | undefined,
  divisible: boolean | undefined,
): string | null {
  if (quantity === undefined) return null;
  const text = String(quantity).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return "Quantity must be a positive number.";
  const value = Number(text);
  if (!(value > 0)) return "Quantity must be greater than zero.";
  if (!divisible && !Number.isInteger(value)) {
    return "A non-divisible asset must have a whole-number supply.";
  }
  if (divisible && (text.split(".")[1]?.length ?? 0) > 8) {
    return "A divisible asset has at most 8 decimal places.";
  }
  return null;
}

export function assertCreationQuantity(
  quantity: string | number | undefined,
  divisible: boolean | undefined,
): void {
  const error = validateCreationQuantity(quantity, divisible);
  if (error) throw new Error(error);
}
