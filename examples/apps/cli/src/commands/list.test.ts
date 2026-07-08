import { describe, it, expect } from "vitest";
import type { AtomicSwap } from "@unspendablelabs/horizon-market-client";
import { SORT_MAP, assetLabel, sortKey, isPurchasable } from "./list.js";

function swap(overrides: Partial<AtomicSwap>): AtomicSwap {
  return {
    id: "s1",
    listingType: "counterparty",
    sellerAddress: "bc1qseller",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    price: 10_000,
    pricePerUnit: null,
    createdAt: "2026-07-08T12:00:00Z",
    pending: false,
    anomalous: false,
    ...overrides,
  } as unknown as AtomicSwap;
}

describe("SORT_MAP", () => {
  it("maps every UI sort option to a server orderBy/order", () => {
    expect(SORT_MAP.latest).toEqual({ orderBy: "created_at", order: "desc" });
    expect(SORT_MAP.oldest).toEqual({ orderBy: "created_at", order: "asc" });
    expect(SORT_MAP.cheapest).toEqual({ orderBy: "price", order: "asc" });
    expect(SORT_MAP.expensive).toEqual({ orderBy: "price", order: "desc" });
    expect(SORT_MAP.cheapest_unit).toEqual({ orderBy: "price_per_unit", order: "asc" });
  });

  it("validation must use Object.hasOwn (inherited keys are not valid sorts)", () => {
    // `"toString" in SORT_MAP` is true (prototype chain) — the reason the command
    // validates with Object.hasOwn instead of the `in` operator.
    expect("toString" in SORT_MAP).toBe(true);
    expect(Object.hasOwn(SORT_MAP, "toString")).toBe(false);
    expect(Object.hasOwn(SORT_MAP, "latest")).toBe(true);
  });
});

describe("assetLabel", () => {
  it("labels ordinals by inscription number (or a fallback)", () => {
    expect(assetLabel(swap({ listingType: "ordinal", inscriptionNumber: 123 }))).toBe("#123");
    expect(assetLabel(swap({ listingType: "ordinal", inscriptionNumber: null }))).toBe(
      "Inscription",
    );
  });

  it("labels Kontor swaps as NFT or KOR", () => {
    expect(assetLabel(swap({ listingType: "kontor", kontorAssetKind: "nft" }))).toBe("NFT");
    expect(assetLabel(swap({ listingType: "kontor", kontorAssetKind: "token" }))).toBe("KOR");
  });

  it("labels other swaps by asset name (em-dash when absent)", () => {
    expect(assetLabel(swap({ assetName: "XCP" }))).toBe("XCP");
    expect(assetLabel(swap({ assetName: null }))).toBe("—");
  });
});

describe("sortKey", () => {
  it("keys by price, price-per-unit (Infinity when null), and created_at", () => {
    expect(sortKey(swap({ price: 42 }), "price")).toBe(42);
    expect(sortKey(swap({ pricePerUnit: 7 }), "price_per_unit")).toBe(7);
    expect(sortKey(swap({ pricePerUnit: null }), "price_per_unit")).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(sortKey(swap({ createdAt: "2026-07-08T12:00:00Z" }), "created_at")).toBe(
      Date.parse("2026-07-08T12:00:00Z"),
    );
  });
});

describe("isPurchasable", () => {
  it("drops pending and anomalous swaps", () => {
    expect(isPurchasable(swap({}))).toBe(true);
    expect(isPurchasable(swap({ pending: true }))).toBe(false);
    expect(isPurchasable(swap({ anomalous: true }))).toBe(false);
  });
});
