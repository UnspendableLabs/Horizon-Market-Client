import { describe, expect, it } from "vitest";
import type { AtomicSwap } from "../../types/index.js";
import {
  checkIsMySwap,
  clampPage,
  getSellerAddresses,
  mergeSwapsById,
  paginateSwaps,
  sortSwaps,
  swapThumbnailUrl,
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

describe("swapThumbnailUrl", () => {
  it("prefers thumbnail with image fallback", () => {
    expect(
      swapThumbnailUrl(
        swap({ id: "a", thumbnailUrl: "thumb.png", imageUrl: "full.png" }),
      ),
    ).toBe("thumb.png");
    expect(
      swapThumbnailUrl(swap({ id: "b", thumbnailUrl: null, imageUrl: "full.png" })),
    ).toBe("full.png");
  });
});
