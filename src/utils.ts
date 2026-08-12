import { base64, hex } from "@scure/base";

export function serializeAssetQuantity(qty: bigint | number): number | string;
export function serializeAssetQuantity(
  qty: bigint | number | null | undefined,
): number | string | null | undefined;
export function serializeAssetQuantity(
  qty: bigint | number | null | undefined,
): number | string | null | undefined {
  if (qty === null || qty === undefined) return qty;
  if (typeof qty === "number") return qty;
  if (qty <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(qty);
  return qty.toString();
}

/** Every PSBT starts with these five bytes. */
const PSBT_MAGIC = "70736274ff";

/**
 * Re-encode a base64 PSBT as hex.
 *
 * The creations API is the only endpoint that answers a base64 PSBT; every
 * signer in this SDK works in hex. The conversion is byte-level rather than a
 * `Psbt.fromBase64().toHex()` round-trip: it keeps bitcoinjs out of a module
 * that only re-encodes bytes, and it cannot re-serialize away a key-value pair
 * the composer set.
 *
 * The magic-byte check is what makes this safe to call on untrusted input —
 * there is deliberately no "already looks like hex, pass it through" heuristic,
 * since a base64 string can consist entirely of hex characters.
 */
export function psbtBase64ToHex(psbtBase64: string): string {
  let encoded: string;
  try {
    encoded = hex.encode(base64.decode(psbtBase64.trim()));
  } catch {
    throw new Error("PSBT is not valid base64");
  }
  if (!encoded.startsWith(PSBT_MAGIC)) {
    throw new Error("PSBT is missing its magic bytes — not a PSBT");
  }
  return encoded;
}
