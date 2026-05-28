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
