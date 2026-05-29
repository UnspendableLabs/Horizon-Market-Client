import { describe, expect, it } from "vitest";
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

describe("showQuantityForAsset", () => {
  it("hides quantity for ordinals", () => {
    expect(
      showQuantityForAsset({
        type: "ordinal",
        inscriptionId: "abc",
        utxoId: "tx:0",
      }),
    ).toBe(false);
  });

  it("shows quantity for zeld and counterparty", () => {
    expect(showQuantityForAsset({ type: "zeld" })).toBe(true);
    expect(
      showQuantityForAsset({ type: "counterparty", assetName: "PEPE" }),
    ).toBe(true);
  });
});

describe("isSellFormValid", () => {
  it("rejects empty and invalid values", () => {
    expect(isSellFormValid(base)).toBe(false);
    expect(
      isSellFormValid({
        ...base,
        asset: { type: "zeld" },
        quantity: "0",
        priceSats: "100",
      }),
    ).toBe(false);
    expect(
      isSellFormValid({
        ...base,
        asset: { type: "zeld" },
        quantity: "not-a-number",
        priceSats: "100",
      }),
    ).toBe(false);
  });

  it("accepts a valid zeld listing", () => {
    expect(
      isSellFormValid({
        asset: { type: "zeld" },
        quantity: "1000",
        priceSats: "250000",
      }),
    ).toBe(true);
  });

  it("accepts a valid ordinal listing without quantity", () => {
    expect(
      isSellFormValid({
        asset: {
          type: "ordinal",
          inscriptionId: "insc",
          utxoId: "deadbeef".repeat(8) + ":0",
        },
        quantity: "",
        priceSats: "1000",
      }),
    ).toBe(true);
  });
});

describe("validateSellForm / buildSellOrderParams", () => {
  it("returns the same validation outcome", () => {
    const invalid = { ...base, asset: { type: "zeld" as const }, priceSats: "" };
    expect(validateSellForm(invalid)).toBeInstanceOf(Error);
    expect(() => buildSellOrderParams(invalid)).toThrow();
  });

  it("builds counterparty params", () => {
    const params = buildSellOrderParams({
      asset: { type: "counterparty", assetName: "RAREPEPE" },
      quantity: "2",
      priceSats: "50000",
    });
    expect(params).toMatchObject({
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 2n,
      priceSats: 50000,
    });
  });

  it("includes default sats per vbyte when provided", () => {
    const params = buildSellOrderParams(
      {
        asset: { type: "zeld" },
        quantity: "1",
        priceSats: "100",
      },
      5,
    );
    expect(params.satsPerVbyte).toBe(5);
  });
});
