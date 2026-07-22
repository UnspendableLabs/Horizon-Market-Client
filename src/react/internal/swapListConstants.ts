import type { ListingType } from "../../types/index.js";

/** The listing-type dimension of the swap filter (an alias of {@link ListingType}). */
export type SwapListingType = ListingType;

/** Server sort key for `listSwaps` (`orderBy`). */
export type SwapListOrderBy = "created_at" | "price" | "price_per_unit";

/** Server sort direction for `listSwaps` (`order`). */
export type SwapListOrder = "asc" | "desc";

/** UI-facing sort presets, each mapping to an `orderBy`/`order` pair (see {@link SORT_MAP}). */
export type SortOption =
  | "latest"
  | "oldest"
  | "cheapest"
  | "expensive"
  | "cheapest_unit";

export const FILTER_TABS: Array<{ key: SwapListingType | null; label: string }> =
  [
    { key: null, label: "All" },
    { key: "counterparty", label: "Counterparty" },
    { key: "ordinal", label: "Ordinals" },
    { key: "zeld", label: "ZELD" },
    { key: "kontor", label: "Kontor" },
  ];

/** Default page size for the swap list. */
export const DEFAULT_LIMIT = 24;

/** Max rows fetched per seller address when merging multi-address "My swaps". */
export const MY_SWAPS_MERGE_FETCH_LIMIT = 500;

/**
 * Rows fetched per `pending_address` query for the "your pending orders" section
 * at the top of the buy list. `pending_address` decorates (doesn't filter) the
 * feed — the address's in-progress orders sort to the very top — so this bounds
 * how far down we scan for them. A wallet's in-flight orders are few, so a small
 * page always captures them all before the ordinary listings begin.
 */
export const PENDING_ORDERS_FETCH_LIMIT = 50;

/**
 * How often (ms) to re-poll the connected wallet's pending orders while at least
 * one remains, so the spinner resolves on its own once the order's tx confirms.
 * Polling stops when none remain.
 */
export const PENDING_ORDERS_POLL_MS = 20_000;

/**
 * Safety cap (ms) for how long an optimistically-tracked Kontor buy stays in the
 * pending section when the server never picks it up as pending (e.g. the record
 * POST failed). Set well above a typical on-chain confirmation so a genuinely
 * in-flight purchase never disappears early; once it elapses the row is dropped
 * and balances are force-refreshed (the KOR has settled by then either way).
 */
export const OPTIMISTIC_PENDING_MAX_MS = 15 * 60_000;

/** Maps each UI {@link SortOption} to the `orderBy`/`order` pair sent to `listSwaps`. */
export const SORT_MAP: Record<
  SortOption,
  { orderBy: SwapListOrderBy; order: SwapListOrder }
> = {
  latest: { orderBy: "created_at", order: "desc" },
  oldest: { orderBy: "created_at", order: "asc" },
  cheapest: { orderBy: "price", order: "asc" },
  expensive: { orderBy: "price", order: "desc" },
  cheapest_unit: { orderBy: "price_per_unit", order: "asc" },
};

/** Human-readable label for each {@link SortOption} (for a sort dropdown). */
export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  latest: "Latest first",
  oldest: "Oldest first",
  cheapest: "Cheapest first",
  expensive: "Most expensive",
  cheapest_unit: "Cheapest per unit",
};

/** All {@link SortOption} keys, in display order. */
export const SORT_OPTIONS = Object.keys(SORT_MAP) as SortOption[];
