import { describe, it, expect } from "vitest";
import { assertSellListingParams } from "./sell-params.js";

describe("assertSellListingParams", () => {
  it("throws when feeUtxoIds and autoSelectFeeUtxos are both set", () => {
    expect(() =>
      assertSellListingParams({
        feeUtxoIds: ["tx:0"],
        autoSelectFeeUtxos: true,
      }),
    ).toThrow("mutually exclusive");
  });

  it("throws when ordinal listing has no assetUtxoId", () => {
    expect(() =>
      assertSellListingParams({ listingType: "ordinal" }),
    ).toThrow("Ordinal listings require assetUtxoId");
  });

  it("throws when counterparty existing UTXO lacks assetName", () => {
    expect(() =>
      assertSellListingParams({
        listingType: "counterparty",
        assetUtxoId: "abcd:0",
        assetQuantity: 1n,
      }),
    ).toThrow("require assetName");
  });

  it("throws when counterparty attach prep lacks assetQuantity", () => {
    expect(() =>
      assertSellListingParams({
        listingType: "counterparty",
        assetName: "RAREPEPE",
      }),
    ).toThrow("attach prep requires assetQuantity");
  });

  it("throws when ZELD transfer prep lacks assetQuantity", () => {
    expect(() =>
      assertSellListingParams({
        listingType: "zeld",
        assetName: "ZELD",
      }),
    ).toThrow("ZELD transfer prep requires assetQuantity");
  });

  it("allows ZELD transfer prep without assetUtxoId", () => {
    expect(() =>
      assertSellListingParams({
        listingType: "zeld",
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
      }),
    ).not.toThrow();
  });

  it('throws when assetName is "ZELD" without listingType "zeld"', () => {
    expect(() =>
      assertSellListingParams({
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
      }),
    ).toThrow('listingType: "zeld"');
  });

  it("throws when ordinal listing uses a P2WPKH seller address", () => {
    expect(() =>
      assertSellListingParams({
        listingType: "ordinal",
        assetUtxoId: "utxo:0",
        sellerAddress: "bc1qseller",
      }),
    ).toThrow("P2TR seller address");
  });
});
