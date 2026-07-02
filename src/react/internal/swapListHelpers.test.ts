import { describe, expect, it } from "vitest";
import type { AtomicSwap } from "../../types/index.js";
import {
  checkIsMySwap,
  clampPage,
  getSellerAddresses,
  mergeSwapsById,
  paginateSwaps,
  sortSwaps,
  swapDisplayName,
  swapDisplayPricePerUnit,
  swapDisplayQuantity,
  swapDisplayTitle,
  swapImageUrl,
} from "./swapListHelpers.js";

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

const ADDRESSES = {
  p2wpkh: "bc1qme",
  p2tr: "bc1pme",
  publicKey: "02aabb",
};

describe("getSellerAddresses", () => {
  it("returns unique p2wpkh and p2tr", () => {
    expect(getSellerAddresses(ADDRESSES)).toEqual(["bc1qme", "bc1pme"]);
  });

  it("dedupes identical addresses", () => {
    expect(getSellerAddresses({ ...ADDRESSES, p2tr: undefined })).toEqual([
      "bc1qme",
    ]);
  });
});

describe("checkIsMySwap", () => {
  it("matches either seller address format", () => {
    expect(checkIsMySwap(swap({ id: "a", sellerAddress: "bc1qme" }), ADDRESSES)).toBe(
      true,
    );
    expect(checkIsMySwap(swap({ id: "b", sellerAddress: "bc1pme" }), ADDRESSES)).toBe(
      true,
    );
    expect(checkIsMySwap(swap({ id: "c", sellerAddress: "bc1other" }), ADDRESSES)).toBe(
      false,
    );
  });
});

describe("mergeSwapsById", () => {
  it("dedupes by id preserving first occurrence", () => {
    const a = swap({ id: "1", price: 100 });
    const b = swap({ id: "2", price: 200 });
    const aDup = swap({ id: "1", price: 999 });
    expect(mergeSwapsById([[a, b], [aDup]])).toEqual([a, b]);
  });
});

describe("sortSwaps / paginateSwaps", () => {
  it("sorts by price ascending", () => {
    const items = sortSwaps(
      [
        swap({ id: "b", price: 200, createdAt: "2024-01-02T00:00:00.000Z" }),
        swap({ id: "a", price: 100, createdAt: "2024-01-01T00:00:00.000Z" }),
      ],
      "price",
      "asc",
    );
    expect(items.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("paginates merged results", () => {
    const items = [
      swap({ id: "1" }),
      swap({ id: "2" }),
      swap({ id: "3" }),
    ];
    expect(paginateSwaps(items, 1, 2)).toEqual({
      items: [items[2]],
      total: 3,
    });
  });
});

describe("clampPage", () => {
  it("keeps page in range when total shrinks", () => {
    expect(clampPage(2, 48, 24)).toBe(1);
    expect(clampPage(0, 48, 24)).toBe(0);
    expect(clampPage(5, 0, 24)).toBe(0);
  });
});

// The server computes price_per_unit = price * 1e8 / rawQuantity for every
// listing (verified against live horizon.market data). For divisible assets one
// whole unit is 1e8 base units, so that value is already the price per whole
// unit; for non-divisible assets it is over-scaled by 1e8.
describe("swapDisplayQuantity / swapDisplayPricePerUnit", () => {
  it("divides the over-scaled per-unit price by 1e8 for non-divisible assets", () => {
    // 2 units (raw 2) at 4000 sats total => server ppu 200,000,000,000, shows 2 × 2000.
    const s = swap({
      id: "a",
      assetQuantity: 2n,
      price: 4000,
      pricePerUnit: 200_000_000_000,
    });
    expect(swapDisplayQuantity(s)).toBe((2).toLocaleString());
    expect(swapDisplayPricePerUnit(s)).toBe(
      (2000).toLocaleString(undefined, { maximumFractionDigits: 8 }),
    );
  });

  it("uses the server per-unit price as-is for divisible assets", () => {
    // 1 whole unit (raw 1e8) at 25000 sats => server ppu already 25000 per whole unit.
    const s = swap({
      id: "b",
      assetDivisibility: true,
      assetQuantity: 100_000_000n,
      price: 25000,
      pricePerUnit: 25000,
    });
    expect(swapDisplayQuantity(s)).toBe((1).toLocaleString());
    expect(swapDisplayPricePerUnit(s)).toBe(
      (25000).toLocaleString(undefined, { maximumFractionDigits: 8 }),
    );
  });

  it("treats zeld listings as divisible (no rescale)", () => {
    // 3000 whole units (raw 3e11) at 9000 sats => server ppu 3 per whole unit.
    const s = swap({
      id: "c",
      listingType: "zeld",
      assetQuantity: 300_000_000_000n,
      price: 9000,
      pricePerUnit: 3,
    });
    expect(swapDisplayQuantity(s)).toBe((3000).toLocaleString());
    expect(swapDisplayPricePerUnit(s)).toBe(
      (3).toLocaleString(undefined, { maximumFractionDigits: 8 }),
    );
  });

  it("returns null per-unit price when pricePerUnit is null", () => {
    expect(swapDisplayPricePerUnit(swap({ id: "d", pricePerUnit: null }))).toBeNull();
  });
});

describe("swapDisplayTitle", () => {
  it("prefixes the asset name with a divisible quantity (0.01 XCP)", () => {
    // 1,000,000 base units of a divisible asset => 0.01 whole units.
    const s = swap({
      id: "x",
      assetName: "XCP",
      assetDivisibility: true,
      assetQuantity: 1_000_000n,
      price: 10000,
      pricePerUnit: 1_000_000,
    });
    expect(swapDisplayTitle(s)).toBe("0.01 XCP");
  });

  it("uses the bare name when there is no quantity (ordinal)", () => {
    const s = swap({
      id: "o",
      listingType: "ordinal",
      assetName: "ORDINAL",
      inscriptionNumber: 42,
    });
    expect(swapDisplayTitle(s)).toBe("#42");
  });
});

// Kontor (KOR token / NFT) listings carry no Counterparty asset_name,
// asset_quantity, or server-computed price_per_unit. Display is derived from
// `kontorAssetKind` / `kontorAmount` instead.
describe("kontor display", () => {
  const korToken = (overrides = {}) =>
    swap({
      id: "k",
      listingType: "kontor",
      kontorAssetKind: "token",
      assetName: null,
      assetQuantity: null,
      pricePerUnit: null,
      kontorAmount: "2000",
      price: 2000,
      ...overrides,
    });

  it('names a token listing "KOR" and uses kontorAmount for quantity', () => {
    const s = korToken();
    expect(swapDisplayName(s)).toBe("KOR");
    expect(swapDisplayQuantity(s)).toBe((2000).toLocaleString());
  });

  it("derives sats-per-KOR from price and kontorAmount", () => {
    // 5000 sats for 2000 KOR => 2.5 sats/KOR.
    const s = korToken({ price: 5000, kontorAmount: "2000" });
    expect(swapDisplayPricePerUnit(s)).toBe(
      (2.5).toLocaleString(undefined, { maximumFractionDigits: 8 }),
    );
  });

  it("has no quantity or per-unit price when kontorAmount is missing", () => {
    const s = korToken({ kontorAmount: null });
    expect(swapDisplayQuantity(s)).toBeNull();
    expect(swapDisplayPricePerUnit(s)).toBeNull();
  });

  it("names an NFT listing by id and shows no quantity/per-unit price", () => {
    const s = swap({
      id: "n",
      listingType: "kontor",
      kontorAssetKind: "nft",
      assetName: null,
      assetQuantity: null,
      pricePerUnit: null,
      kontorNftId: "punk-42",
    });
    expect(swapDisplayName(s)).toBe("punk-42");
    expect(swapDisplayQuantity(s)).toBeNull();
    expect(swapDisplayPricePerUnit(s)).toBeNull();
  });
});

describe("swapImageUrl", () => {
  it("prefers the full image with thumbnail fallback", () => {
    expect(
      swapImageUrl(
        swap({ id: "a", thumbnailUrl: "thumb.png", imageUrl: "full.png" }),
      ),
    ).toBe("full.png");
    expect(
      swapImageUrl(swap({ id: "b", thumbnailUrl: "thumb.png", imageUrl: null })),
    ).toBe("thumb.png");
  });
});
