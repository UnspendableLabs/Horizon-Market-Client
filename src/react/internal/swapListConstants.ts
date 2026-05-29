import type { SwapListingType } from "../hooks/useSwapList.js";

export const FILTER_TABS: Array<{ key: SwapListingType | null; label: string }> =
  [
    { key: null, label: "All" },
    { key: "counterparty", label: "Counterparty" },
    { key: "ordinal", label: "Ordinals" },
    { key: "zeld", label: "ZELD" },
  ];

/** Max rows fetched per seller address when merging multi-address "My swaps". */
export const MY_SWAPS_MERGE_FETCH_LIMIT = 500;
