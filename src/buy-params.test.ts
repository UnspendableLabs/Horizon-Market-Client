import { describe, it, expect } from "vitest";
import { assertBuyQuoteParams, assertP2WpkhBuyerAddress } from "./buy-params.js";

describe("assertP2WpkhBuyerAddress", () => {
  it("accepts bc1q and tb1q addresses", () => {
    expect(() => assertP2WpkhBuyerAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).not.toThrow();
    expect(() => assertP2WpkhBuyerAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).not.toThrow();
  });

  it("rejects non-P2WPKH addresses", () => {
    expect(() => assertP2WpkhBuyerAddress("bc1pinscription")).toThrow("P2WPKH");
  });
});

describe("assertBuyQuoteParams", () => {
  it("throws when swapIds is empty", () => {
    expect(() =>
      assertBuyQuoteParams({
        swapIds: [],
        buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      }),
    ).toThrow("At least one swapId is required");
  });

  it("throws when fundingUtxoIds and autoSelect are both set", () => {
    expect(() =>
      assertBuyQuoteParams({
        swapIds: ["swap_1"],
        buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        fundingUtxoIds: ["tx:0"],
        autoSelect: true,
      }),
    ).toThrow("mutually exclusive");
  });
});
