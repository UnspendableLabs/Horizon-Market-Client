import { describe, expect, it } from "vitest";
import type { AtomicSwap } from "../../types/index.js";
import {
  sortSwaps,
  swapDisplayName,
  swapListItemView,
  swapMonogram,
} from "./swapListHelpers.js";

// Same base fixture shape as swapListHelpers.test.ts, replicated here because the
// existing helper is file-local (and this file must not edit that one).
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
    ...overrides,
  };
}

// Covers the ordinal-with-no-inscription-number fallback (line 43): existing
// coverage only hits the `#<number>` branch.
describe("swapDisplayName — ordinal without inscription number", () => {
  it("falls back to the asset name", () => {
    const s = swap({
      id: "o1",
      listingType: "ordinal",
      inscriptionNumber: null,
      assetName: "Named Ordinal",
    });
    expect(swapDisplayName(s)).toBe("Named Ordinal");
  });

  it("falls back to an em dash when there is neither number nor name", () => {
    const s = swap({
      id: "o2",
      listingType: "ordinal",
      inscriptionNumber: null,
      assetName: null,
    });
    expect(swapDisplayName(s)).toBe("—");
  });
});

// Covers `swapMonogram` (lines 142-157) — not imported by the existing suite.
describe("swapMonogram", () => {
  it("uses fixed brand monograms for zeld / ordinal / kontor listings", () => {
    expect(swapMonogram(swap({ id: "z", listingType: "zeld" }))).toEqual({
      label: "ZELD",
      bg: "#2563eb",
    });
    expect(swapMonogram(swap({ id: "o", listingType: "ordinal" }))).toEqual({
      label: "ORD",
      bg: "#f97316",
    });
    expect(
      swapMonogram(
        swap({ id: "n", listingType: "kontor", kontorAssetKind: "nft" }),
      ),
    ).toEqual({ label: "NFT", bg: "#a855f7" });
    expect(
      swapMonogram(
        swap({ id: "k", listingType: "kontor", kontorAssetKind: "token" }),
      ),
    ).toEqual({ label: "KOR", bg: "#f59e0b" });
  });

  it("hashes a Counterparty asset name to a deterministic label + hue", () => {
    const m = swapMonogram(
      swap({ id: "c", listingType: "counterparty", assetName: "RAREPEPE" }),
    );
    expect(m.label).toBe("RARE");
    expect(m.bg).toMatch(/^#[0-9a-f]{6}$/);
    // Same name -> same hue (stable across instances).
    expect(swapMonogram(swap({ id: "c2", assetName: "RAREPEPE" })).bg).toBe(
      m.bg,
    );
  });

  it("uses '?' as the label when a Counterparty asset has no name", () => {
    const m = swapMonogram(swap({ id: "q", assetName: null }));
    expect(m.label).toBe("?");
    expect(m.bg).toMatch(/^#/);
  });
});

// Covers `swapListItemView` (lines 179-192) — not imported by the existing suite.
describe("swapListItemView", () => {
  it("labels the viewer's own listing 'Delist' and derives the tile fields", () => {
    const s = swap({
      id: "mine",
      assetName: "XCP",
      assetDivisibility: true,
      assetQuantity: 1_000_000n,
      price: 10000,
      pricePerUnit: 1_000_000,
      imageUrl: "full.png",
      thumbnailUrl: "thumb.png",
    });
    expect(swapListItemView(s, true)).toEqual({
      actionLabel: "Delist",
      thumbnail: "full.png",
      title: "0.01 XCP",
      priceLabel: "10,000 sats",
      pricePerUnit: (1_000_000).toLocaleString("en-US", {
        maximumFractionDigits: 8,
      }),
      showPerUnit: true,
    });
  });

  it("labels other sellers' listings 'Buy' and hides the per-unit line for ordinals", () => {
    const s = swap({
      id: "ord",
      listingType: "ordinal",
      inscriptionNumber: 7,
      pricePerUnit: null,
      price: 5000,
    });
    const view = swapListItemView(s, false);
    expect(view.actionLabel).toBe("Buy");
    expect(view.title).toBe("#7");
    expect(view.pricePerUnit).toBeNull();
    expect(view.showPerUnit).toBe(false);
    expect(view.thumbnail).toBeNull();
    expect(view.priceLabel).toBe("5,000 sats");
  });
});

// Covers the `price_per_unit` case of `compareSwaps` (lines 222-226) plus the
// descending path — the existing suite only sorts by `price`.
describe("sortSwaps by price_per_unit", () => {
  it("orders ascending, treating a null per-unit price as the highest", () => {
    const items = sortSwaps(
      [
        swap({ id: "hi", pricePerUnit: 500 }),
        swap({ id: "none", pricePerUnit: null }),
        swap({ id: "lo", pricePerUnit: 100 }),
      ],
      "price_per_unit",
      "asc",
    );
    expect(items.map((s) => s.id)).toEqual(["lo", "hi", "none"]);
  });

  it("orders descending", () => {
    const items = sortSwaps(
      [
        swap({ id: "a", pricePerUnit: 100 }),
        swap({ id: "b", pricePerUnit: 500 }),
      ],
      "price_per_unit",
      "desc",
    );
    expect(items.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
