import { describe, expect, it } from "vitest";
import type { SwapListingType } from "../hooks/useSwapList.js";
import {
  FILTER_TABS,
  MY_SWAPS_MERGE_FETCH_LIMIT,
  visibleFilterTabs,
} from "./swapListConstants.js";

describe("FILTER_TABS", () => {
  it("leads with an 'All' tab keyed by null", () => {
    expect(FILTER_TABS[0]).toEqual({ key: null, label: "All" });
  });

  it("lists every listing-type filter with a label", () => {
    expect(FILTER_TABS).toEqual([
      { key: null, label: "All" },
      { key: "counterparty", label: "Counterparty" },
      { key: "ordinal", label: "Ordinals" },
      { key: "zeld", label: "ZELD" },
      { key: "kontor", label: "Kontor" },
    ]);
  });

  it("filters to the visible protocols via visibleFilterTabs", () => {
    // A mainnet app today: ZELD visible, Kontor not.
    expect(
      visibleFilterTabs({ zeld: true, kontor: false }).map((t) => t.key),
    ).toEqual([null, "counterparty", "ordinal", "zeld"]);
    // A signet app today: the reverse.
    expect(
      visibleFilterTabs({ zeld: false, kontor: true }).map((t) => t.key),
    ).toEqual([null, "counterparty", "ordinal", "kontor"]);
    // Everything configured (e.g. once Kontor reaches mainnet): all tabs.
    expect(visibleFilterTabs({ zeld: true, kontor: true })).toEqual(FILTER_TABS);
  });

  it("uses only null or valid SwapListingType keys", () => {
    const valid: Array<SwapListingType | null> = [
      null,
      "counterparty",
      "ordinal",
      "zeld",
      "kontor",
    ];
    for (const tab of FILTER_TABS) {
      expect(valid).toContain(tab.key);
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });
});

describe("MY_SWAPS_MERGE_FETCH_LIMIT", () => {
  it("caps per-address merge fetches at 500", () => {
    expect(MY_SWAPS_MERGE_FETCH_LIMIT).toBe(500);
  });
});
