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
