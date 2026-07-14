import type { SwapListingType } from "../hooks/useSwapList.js";

export const FILTER_TABS: Array<{ key: SwapListingType | null; label: string }> =
  [
    { key: null, label: "All" },
    { key: "counterparty", label: "Counterparty" },
    { key: "ordinal", label: "Ordinals" },
    { key: "zeld", label: "ZELD" },
    { key: "kontor", label: "Kontor" },
  ];

/** Max rows fetched per seller address when merging multi-address "My swaps". */
export const MY_SWAPS_MERGE_FETCH_LIMIT = 500;

/**
 * Max own "awaiting confirmation" (`funded: false`) listings fetched per seller
 * address for the pending section shown at the top of the buy list. Freshly
 * created listings are few, so a small page is plenty.
 */
export const PENDING_OWN_SWAPS_FETCH_LIMIT = 50;

/**
 * How often (ms) to re-poll the connected wallet's own awaiting-confirmation
 * listings while at least one is pending, so the spinner resolves on its own
 * once the funding tx confirms. Polling stops when none remain.
 */
export const PENDING_OWN_SWAPS_POLL_MS = 20_000;
