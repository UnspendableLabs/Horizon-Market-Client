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

/**
 * The image to show on a swap-list tile. Prefer `imageUrl` (the full-size
 * artwork) over `thumbnailUrl`: the tile renders the image as a large square
 * panel, so the 48×48 `thumbnail_url` — meant for small pictos — would look
 * blurry stretched to that size. Fall back to it only when there's no full image.
 */
export function swapImageUrl(swap: AtomicSwap): string | null {
  return swap.imageUrl ?? swap.thumbnailUrl;
}

export function swapDisplayName(swap: AtomicSwap): string {
  if (swap.listingType === "kontor") {
    // Kontor listings carry no Counterparty `assetName`. Tokens are always the
    // native KOR token; NFTs fall back to their id (or a generic label).
    if (swap.kontorAssetKind === "nft") {
      return swap.assetName ?? swap.kontorNftId ?? "Kontor NFT";
    }
    return "KOR";
  }
  if (swap.listingType === "ordinal") {
    return swap.inscriptionNumber !== null
      ? `#${swap.inscriptionNumber}`
      : (swap.assetName ?? "—");
  }
  // Counterparty (and zeld): subassets list under a numeric `A…` assetName —
  // show the human-readable long name when the server resolved one.
  return swap.assetLongname ?? swap.assetName ?? "—";
}

export function formatQuantity(quantity: bigint, divisible: boolean): string {
  if (!divisible) return quantity.toLocaleString("en-US");
  const SAT = BigInt("100000000");
  const whole = quantity / SAT;
  const remainder = quantity % SAT;
  if (remainder === 0n) return whole.toLocaleString("en-US");
  const dec = remainder.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${dec}`;
}

/** Format a Kontor token amount (a decimal string) for display. */
function formatKontorAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function swapDisplayQuantity(swap: AtomicSwap): string | null {
  if (swap.listingType === "kontor") {
    // KOR token amounts live in `kontorAmount` (a decimal string), not
    // `assetQuantity`. NFTs are single, indivisible items with no quantity.
    if (swap.kontorAssetKind === "nft") return null;
    return swap.kontorAmount === null
      ? null
      : formatKontorAmount(swap.kontorAmount);
  }
  if (swap.listingType === "ordinal") return null;
  if (swap.assetQuantity === null) return null;
  const divisible =
    swap.listingType === "zeld" || swap.assetDivisibility === true;
  return formatQuantity(swap.assetQuantity, divisible);
}

/**
 * Tile title: the asset name prefixed with its quantity for fungible listings
 * (e.g. "0.01 XCP", "2,000 KOR"), matching horizon.market where the amount sits
 * beside the asset. 1-of-1 items (ordinals, Kontor NFTs) have no quantity, so
 * the bare name is used.
 */
export function swapDisplayTitle(swap: AtomicSwap): string {
  const name = swapDisplayName(swap);
  const quantity = swapDisplayQuantity(swap);
  return quantity !== null ? `${quantity} ${name}` : name;
}

/**
 * Per-unit price formatted for display.
 *
 * The server computes `pricePerUnit` as `price * 1e8 / rawQuantity` for every
 * listing. For a divisible asset (zeld / `assetDivisibility`) one whole unit is
 * 1e8 base units, so that formula already yields the price per *whole* unit —
 * use it as-is. For a non-divisible asset `rawQuantity` is the literal unit
 * count, so the server value is over-scaled by 1e8 and must be divided back down
 * to read as sats per unit (e.g. "200,000,000,000" -> "2,000" for 2 units at
 * 4,000 sats). This keeps the per-unit price consistent with the quantity shown
 * by `swapDisplayQuantity`, so `quantity x perUnit` matches the total `price`.
 */
export function swapDisplayPricePerUnit(swap: AtomicSwap): string | null {
  if (swap.listingType === "kontor") {
    // The server doesn't compute `pricePerUnit` for Kontor tokens, so derive
    // sats-per-KOR from the total price and `kontorAmount`. NFTs are single
    // items with no per-unit price.
    if (swap.kontorAssetKind === "nft") return null;
    const amount = Number(swap.kontorAmount ?? 0);
    if (!amount || !Number.isFinite(amount)) return null;
    return (swap.price / amount).toLocaleString("en-US", {
      maximumFractionDigits: 8,
    });
  }
  if (swap.pricePerUnit === null) return null;
  const divisible =
    swap.listingType === "zeld" || swap.assetDivisibility === true;
  const perUnit = divisible ? swap.pricePerUnit : swap.pricePerUnit / 1e8;
  return perUnit.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Deterministic palette for the Counterparty-asset monogram fallback. */
const MONOGRAM_HUES = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

/**
 * Monogram fallback for a swap with no artwork: a short label + a background
 * colour. Kontor / ordinal / zeld listings get fixed brand colours; Counterparty
 * assets get a stable hue hashed from the asset name. Shared by the web and
 * native `BuyReview` avatar placeholders so both render identically.
 */
export function swapMonogram(swap: AtomicSwap): { label: string; bg: string } {
  if (swap.listingType === "zeld") return { label: "ZELD", bg: "#2563eb" };
  if (swap.listingType === "ordinal") return { label: "ORD", bg: "#f97316" };
  if (swap.listingType === "kontor")
    return swap.kontorAssetKind === "nft"
      ? { label: "NFT", bg: "#a855f7" }
      : { label: "KOR", bg: "#f59e0b" };
  // Label letters come from the display name (long name for subassets), but the
  // hue stays seeded on the stable on-chain `assetName` so an asset keeps the
  // same colour whether or not a long name resolved (matches `assetMonogram`).
  const seed = swap.assetName ?? "?";
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return {
    label: (swap.assetLongname ?? swap.assetName ?? "?").slice(0, 4),
    bg: MONOGRAM_HUES[Math.abs(hash) % MONOGRAM_HUES.length],
  };
}

export interface SwapListItemView {
  /** "Delist" for the viewer's own listings, "Buy" otherwise. */
  actionLabel: "Buy" | "Delist";
  /** Artwork URL, or `null` for the "no image" placeholder. */
  thumbnail: string | null;
  /** Quantity-prefixed asset title (e.g. "0.01 XCP"). */
  title: string;
  /** Total price rendered as "12,345 sats". */
  priceLabel: string;
  /** Per-unit price string, or `null` when it shouldn't be shown. */
  pricePerUnit: string | null;
  /** Whether to render the per-unit meta line (hidden for 1-of-1 ordinals). */
  showPerUnit: boolean;
}

/**
 * Derives everything a swap-list tile displays from an {@link AtomicSwap}, so the
 * web and native tile renderers only lay out the returned values instead of each
 * re-deriving the label/title/price fields.
 */
export function swapListItemView(
  swap: AtomicSwap,
  isMySwap: boolean,
): SwapListItemView {
  const pricePerUnit = swapDisplayPricePerUnit(swap);
  return {
    actionLabel: isMySwap ? "Delist" : "Buy",
    thumbnail: swapImageUrl(swap),
    title: swapDisplayTitle(swap),
    priceLabel: `${swap.price.toLocaleString("en-US")} sats`,
    pricePerUnit,
    showPerUnit: swap.listingType !== "ordinal" && pricePerUnit !== null,
  };
}

/**
 * Best on-chain txid to link (e.g. mempool.space) for a pending order. Prefers
 * the server-provided {@link AtomicSwap.pendingTxid} — authoritative for both a
 * pending sale (the buyer's in-flight buy tx) and a pending listing (whichever of
 * the seller's own txs is still unconfirmed). Falls back to deriving it from the
 * listing itself (asset UTXO tx → swap tx → platform-fee tx) for items that carry
 * no `pendingTxid` (e.g. a `getSwap` detail). Null when none is known yet.
 */
export function pendingSwapTrackingTxid(swap: AtomicSwap): string | null {
  if (swap.pendingTxid) return swap.pendingTxid;
  const assetTxid = swap.assetUtxoId?.split(":")[0];
  return assetTxid || swap.txId || swap.onChainPayment?.txid || null;
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
