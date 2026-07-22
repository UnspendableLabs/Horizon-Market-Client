import { describe, expect, it } from "vitest";
import type { AtomicSwap } from "../types/index.js";
import * as swaps from "./index.js";
import {
  checkIsMySwap,
  clampPage,
  DEFAULT_LIMIT,
  FILTER_TABS,
  getSellerAddresses,
  mergeSwapsById,
  MY_SWAPS_MERGE_FETCH_LIMIT,
  paginateSwaps,
  PENDING_ORDERS_FETCH_LIMIT,
  PENDING_ORDERS_POLL_MS,
  sortSwaps,
  SORT_MAP,
  SORT_OPTION_LABELS,
  SORT_OPTIONS,
  swapDisplayName,
  swapDisplayTitle,
  swapListItemView,
  type SortOption,
  type SwapListingType,
} from "./index.js";

// This entry is the WASM-free re-export surface an app consumes from
// `@unspendablelabs/horizon-market-client/swaps`, so the point of this suite is
// to prove the full public surface of both pure modules is actually re-exported
// here (a dropped re-export would break the app that stopped duplicating it).

function swap(
  overrides: Partial<AtomicSwap> & Pick<AtomicSwap, "id">,
): AtomicSwap {
  return {
    listingType: "counterparty",
    sellerAddress: "bc1qseller",
    buyerAddress: null,
    assetUtxoId: null,
    assetUtxoValue: null,
    assetName: "TEST",
    assetQuantity: 1n,
    price: 1000,
    pricePerUnit: 1000,
    psbtHex: null,
    txId: null,
    blockIndex: null,
    funded: true,
    filled: false,
    confirmed: true,
    delisted: false,
    sellerDelisted: false,
    expired: false,
    pending: false,
    anomalous: false,
    royalty: null,
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    onChainPayment: null,
    imageUrl: null,
    thumbnailUrl: null,
    inscriptionNumber: null,
    assetDivisibility: null,
    kontorOfferBlob: null,
    kontorAssetKind: null,
    kontorContractAddress: null,
    kontorNftId: null,
    kontorAmount: null,
    pendingRole: null,
    pendingTxid: null,
    ...overrides,
  };
}

describe("/swaps re-export surface", () => {
  it("re-exports the sort presets from swapListConstants", () => {
    expect(SORT_OPTIONS).toEqual([
      "latest",
      "oldest",
      "cheapest",
      "expensive",
      "cheapest_unit",
    ]);
    for (const key of SORT_OPTIONS) {
      expect(SORT_OPTION_LABELS[key].length).toBeGreaterThan(0);
      expect(SORT_MAP[key]).toBeDefined();
    }
    expect(SORT_MAP.latest).toEqual({ orderBy: "created_at", order: "desc" });
    expect(SORT_MAP.cheapest_unit).toEqual({
      orderBy: "price_per_unit",
      order: "asc",
    });
  });

  it("re-exports the list constants from swapListConstants", () => {
    expect(DEFAULT_LIMIT).toBe(24);
    expect(MY_SWAPS_MERGE_FETCH_LIMIT).toBe(500);
    expect(PENDING_ORDERS_FETCH_LIMIT).toBe(50);
    expect(PENDING_ORDERS_POLL_MS).toBe(20_000);
    expect(swaps.OPTIMISTIC_PENDING_MAX_MS).toBe(15 * 60_000);
    expect(FILTER_TABS[0]).toEqual({ key: null, label: "All" });
    expect(FILTER_TABS.map((t) => t.key)).toEqual([
      null,
      "counterparty",
      "ordinal",
      "zeld",
      "kontor",
    ]);
  });

  it("re-exports the pure display helpers from swapListHelpers", () => {
    // A representative slice of the display derivations + list utilities.
    expect(typeof swaps.swapDisplayName).toBe("function");
    expect(typeof swaps.swapDisplayTitle).toBe("function");
    expect(typeof swaps.swapDisplayQuantity).toBe("function");
    expect(typeof swaps.swapDisplayPricePerUnit).toBe("function");
    expect(typeof swaps.swapImageUrl).toBe("function");
    expect(typeof swaps.swapMonogram).toBe("function");
    expect(typeof swaps.swapListItemView).toBe("function");
    expect(typeof swaps.pendingSwapTrackingTxid).toBe("function");
    expect(typeof swaps.formatQuantity).toBe("function");
    expect(typeof swaps.getSellerAddresses).toBe("function");
    expect(typeof swaps.checkIsMySwap).toBe("function");
    expect(typeof swaps.mergeSwapsById).toBe("function");
    expect(typeof swaps.sortSwaps).toBe("function");
    expect(typeof swaps.paginateSwaps).toBe("function");
    expect(typeof swaps.clampPage).toBe("function");
  });

  it("the re-exported helpers actually work (identity check)", () => {
    const s = swap({
      id: "x",
      assetName: "XCP",
      assetDivisibility: true,
      assetQuantity: 1_000_000n,
    });
    expect(swapDisplayName(s)).toBe("XCP");
    expect(swapDisplayTitle(s)).toBe("0.01 XCP");
    expect(swapListItemView(s, false).actionLabel).toBe("Buy");
    expect(swapListItemView(s, true).actionLabel).toBe("Delist");

    const a = swap({ id: "a", price: 100 });
    const b = swap({ id: "b", price: 200 });
    expect(mergeSwapsById([[a, b], [swap({ id: "a" })]]).map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSwaps([b, a], "price", "asc").map((x) => x.id)).toEqual(["a", "b"]);
    expect(paginateSwaps([a, b], 1, 1)).toEqual({ items: [b], total: 2 });
    expect(clampPage(5, 0, 24)).toBe(0);

    expect(
      getSellerAddresses({ p2wpkh: "bc1q", p2tr: "bc1p", publicKey: "02aa" }),
    ).toEqual(["bc1q", "bc1p"]);
    expect(
      checkIsMySwap(swap({ id: "m", sellerAddress: "bc1q" }), {
        p2wpkh: "bc1q",
        p2tr: "bc1p",
        publicKey: "02aa",
      }),
    ).toBe(true);
  });

  it("exposes the SortOption and SwapListingType types", () => {
    // Type-level assertion: these must be re-exported for the app to type its
    // filter state without a value import (compile-time only).
    const sort: SortOption = "latest";
    const type: SwapListingType = "counterparty";
    expect(SORT_OPTIONS).toContain(sort);
    expect(FILTER_TABS.some((t) => t.key === type)).toBe(true);
  });
});
