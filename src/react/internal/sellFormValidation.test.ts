import { describe, expect, it } from "vitest";
import type { AssetOption } from "../hooks/useAssets.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";
import {
  buildSellOrderParams,
  isSellFormValid,
  showQuantityForAsset,
  validateSellForm,
} from "./sellFormValidation.js";

const base: SellOrderFormValues = {
  asset: null,
  quantity: "",
  priceSats: "",
};

// ─── Fixture assets (new owned-balance shapes) ───────────────────────────────
const P2WPKH = "bc1qseller";
const P2TR = "bc1pseller";

const xcp: AssetOption = {
  type: "counterparty",
  assetName: "XCP",
  address: P2WPKH,
  balance: 1_250_000_000n, // 12.5 XCP (divisible)
  quantityNormalized: "12.5",
  divisible: true,
};

const rarepepe: AssetOption = {
  type: "counterparty",
  assetName: "RAREPEPE",
  address: P2TR,
  balance: 5n, // 5 units (indivisible)
  quantityNormalized: "5",
  divisible: false,
};

const zeld: AssetOption = {
  type: "zeld",
  address: P2WPKH,
  balance: 100_000_000n, // 1 ZELD
  quantityNormalized: "1.00000000",
  divisible: true,
};

const ordinal: AssetOption = {
  type: "ordinal",
  inscriptionId: "insc",
  utxoId: "deadbeef".repeat(8) + ":0",
  address: P2TR,
};

const kor: AssetOption = { type: "kor", address: P2TR, amount: "100.5" };

const nft: AssetOption = {
  type: "kontor-nft",
  nftId: "my-nft",
  contractAddress: "art@1.0",
  address: P2TR,
};

describe("showQuantityForAsset", () => {
  it("hides quantity for ordinals and kontor NFTs", () => {
    expect(showQuantityForAsset(ordinal)).toBe(false);
    expect(showQuantityForAsset(nft)).toBe(false);
  });

  it("shows quantity for fungibles (counterparty / zeld / kor)", () => {
    expect(showQuantityForAsset(xcp)).toBe(true);
    expect(showQuantityForAsset(zeld)).toBe(true);
    expect(showQuantityForAsset(kor)).toBe(true);
  });
});

describe("isSellFormValid", () => {
  it("rejects empty and invalid values", () => {
    expect(isSellFormValid(base)).toBe(false);
    expect(
      isSellFormValid({ ...base, asset: zeld, quantity: "0", priceSats: "100" }),
    ).toBe(false);
    expect(
      isSellFormValid({
        ...base,
        asset: zeld,
        quantity: "not-a-number",
        priceSats: "100",
      }),
    ).toBe(false);
  });

  it("accepts a valid divisible listing (human units)", () => {
    expect(
      isSellFormValid({ asset: zeld, quantity: "0.5", priceSats: "250000" }),
    ).toBe(true);
  });

  it("rejects a quantity exceeding the owned balance", () => {
    // xcp balance is 12.5 — 13 is too much.
    expect(
      isSellFormValid({ asset: xcp, quantity: "13", priceSats: "1000" }),
    ).toBe(false);
    expect(
      isSellFormValid({ asset: xcp, quantity: "12.5", priceSats: "1000" }),
    ).toBe(true);
  });

  it("rejects fractional quantities for indivisible assets", () => {
    expect(
      isSellFormValid({ asset: rarepepe, quantity: "1.5", priceSats: "1000" }),
    ).toBe(false);
    expect(
      isSellFormValid({ asset: rarepepe, quantity: "2", priceSats: "1000" }),
    ).toBe(true);
  });

  it("accepts ordinal / NFT listings without quantity", () => {
    expect(
      isSellFormValid({ asset: ordinal, quantity: "", priceSats: "1000" }),
    ).toBe(true);
    expect(
      isSellFormValid({ asset: nft, quantity: "", priceSats: "1000" }),
    ).toBe(true);
  });

  it("accepts a KOR listing with a decimal amount", () => {
    expect(
      isSellFormValid({ asset: kor, quantity: "10.25", priceSats: "1000" }),
    ).toBe(true);
  });
});

describe("validateSellForm / buildSellOrderParams", () => {
  it("returns the same validation outcome", () => {
    const invalid = { ...base, asset: zeld, priceSats: "" };
    expect(validateSellForm(invalid)).toBeInstanceOf(Error);
    expect(() => buildSellOrderParams(invalid)).toThrow();
  });

  it("builds counterparty params with sellerAddress and base-unit quantity", () => {
    const params = buildSellOrderParams({
      asset: xcp,
      quantity: "2",
      priceSats: "50000",
    });
    expect(params).toMatchObject({
      listingType: "counterparty",
      assetName: "XCP",
      assetQuantity: 200_000_000n, // 2 × 1e8 (divisible)
      priceSats: 50000,
      sellerAddress: P2WPKH,
    });
  });

  it("targets the P2TR address when the asset is held there", () => {
    const params = buildSellOrderParams({
      asset: rarepepe,
      quantity: "3",
      priceSats: "1000",
    });
    expect(params).toMatchObject({
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 3n, // indivisible → integer base units
      sellerAddress: P2TR,
    });
  });

  it("builds zeld params with sellerAddress and 8-decimal base units", () => {
    const params = buildSellOrderParams({
      asset: zeld,
      quantity: "0.5",
      priceSats: "1000",
    });
    expect(params).toMatchObject({
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: 50_000_000n,
      sellerAddress: P2WPKH,
    });
  });

  it("builds ordinal params targeting the holding address", () => {
    const params = buildSellOrderParams({
      asset: ordinal,
      quantity: "",
      priceSats: "1000",
    });
    expect(params).toMatchObject({
      listingType: "ordinal",
      assetUtxoId: ordinal.type === "ordinal" ? ordinal.utxoId : "",
      sellerAddress: P2TR,
    });
  });

  it("builds KOR token params with the decimal amount", () => {
    const params = buildSellOrderParams({
      asset: kor,
      quantity: "100.5",
      priceSats: "1000",
    });
    expect(params).toMatchObject({
      listingType: "kontor",
      kontorAssetKind: "token",
      korAmount: "100.5",
      priceSats: 1000,
    });
  });

  it("builds Kontor NFT params", () => {
    const params = buildSellOrderParams({
      asset: nft,
      quantity: "",
      priceSats: "2000",
    });
    expect(params).toMatchObject({
      listingType: "kontor",
      kontorAssetKind: "nft",
      nftId: "my-nft",
      nftContractAddress: "art@1.0",
      priceSats: 2000,
    });
  });

  it("rejects a quantity above the owned balance", () => {
    expect(() =>
      buildSellOrderParams({ asset: xcp, quantity: "100", priceSats: "1000" }),
    ).toThrow(/exceeds balance/);
  });

  it("includes default sats per vbyte when provided", () => {
    const params = buildSellOrderParams(
      { asset: zeld, quantity: "0.1", priceSats: "100" },
      5,
    );
    expect(params.satsPerVbyte).toBe(5);
  });
});
