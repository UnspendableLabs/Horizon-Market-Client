import type { AtomicSwap } from "../../types/index.js";
import type { Addresses } from "../context.js";
import type { SwapListOrder, SwapListOrderBy } from "../hooks/useSwapList.js";

export function getSellerAddresses(addresses: Addresses): string[] {
  const addrs = [addresses.p2wpkh, addresses.p2tr].filter(Boolean) as string[];
  return [...new Set(addrs)];
}

export function checkIsMySwap(
  swap: AtomicSwap,
  addresses: Addresses | null,
): boolean {
  if (!addresses) return false;
  return (
    swap.sellerAddress === addresses.p2tr ||
    swap.sellerAddress === addresses.p2wpkh
  );
}

export function swapThumbnailUrl(swap: AtomicSwap): string | null {
  return swap.thumbnailUrl ?? swap.imageUrl;
}

export function swapDisplayName(swap: AtomicSwap): string {
  if (swap.listingType === "ordinal") {
    return swap.inscriptionNumber !== null
      ? `#${swap.inscriptionNumber}`
      : (swap.assetName ?? "—");
  }
  return swap.assetName ?? "—";
}

export function formatQuantity(quantity: bigint, divisible: boolean): string {
  if (!divisible) return quantity.toLocaleString();
  const SAT = BigInt("100000000");
  const whole = quantity / SAT;
  const remainder = quantity % SAT;
  if (remainder === 0n) return whole.toLocaleString();
  const dec = remainder.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${dec}`;
}

export function swapDisplayQuantity(swap: AtomicSwap): string | null {
  if (swap.listingType === "ordinal") return null;
  if (swap.assetQuantity === null) return null;
  const divisible =
    swap.listingType === "zeld" || swap.assetDivisibility === true;
  return formatQuantity(swap.assetQuantity, divisible);
}

export function mergeSwapsById(lists: AtomicSwap[][]): AtomicSwap[] {
  const seen = new Set<string>();
  const merged: AtomicSwap[] = [];
  for (const list of lists) {
    for (const swap of list) {
      if (seen.has(swap.id)) continue;
      seen.add(swap.id);
      merged.push(swap);
    }
  }
  return merged;
}

function compareSwaps(
  a: AtomicSwap,
  b: AtomicSwap,
  orderBy: SwapListOrderBy,
  order: SwapListOrder,
): number {
  let cmp = 0;
  switch (orderBy) {
    case "created_at":
      cmp = a.createdAt.localeCompare(b.createdAt);
      break;
    case "price":
      cmp = a.price - b.price;
      break;
    case "price_per_unit": {
      const aUnit = a.pricePerUnit ?? Number.POSITIVE_INFINITY;
      const bUnit = b.pricePerUnit ?? Number.POSITIVE_INFINITY;
      cmp = aUnit - bUnit;
      break;
    }
  }
  return order === "asc" ? cmp : -cmp;
}

export function sortSwaps(
  swaps: AtomicSwap[],
  orderBy: SwapListOrderBy,
  order: SwapListOrder,
): AtomicSwap[] {
  return [...swaps].sort((a, b) => compareSwaps(a, b, orderBy, order));
}

export function paginateSwaps(
  swaps: AtomicSwap[],
  page: number,
  limit: number,
): { items: AtomicSwap[]; total: number } {
  const total = swaps.length;
  const start = page * limit;
  return { items: swaps.slice(start, start + limit), total };
}

export function clampPage(page: number, total: number, limit: number): number {
  if (limit <= 0) return 0;
  const maxPage = Math.max(0, Math.ceil(total / limit) - 1);
  return Math.min(page, maxPage);
}
