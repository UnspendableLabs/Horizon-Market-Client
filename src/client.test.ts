import { describe, it, expect, vi } from "vitest";
import { HorizonMarketClient } from "./client.js";
import { makeFetch, makeSigner } from "./test-utils.js";

describe("HorizonMarketClient.requestSellQuote", () => {
  it("throws for ZELD on testnet", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
    });

    expect(() =>
      client.requestSellQuote({
        price: 1000,
        sellerAddress: "bc1qseller",
        listingType: "zeld",
        assetName: "ZELD",
        assetQuantity: 1n,
        assetUtxoId: "utxo:0",
      }),
    ).toThrow("ZELD listings are only supported on mainnet");
  });

  it("throws when P2TR sellerAddress has no sellerPubkey", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestSellQuote({
        price: 1000,
        sellerAddress: "bc1pexternal",
        listingType: "ordinal",
        assetUtxoId: "utxo:0",
      }),
    ).toThrow("P2TR sellerAddress requires sellerPubkey");
  });

  it("throws when ordinal listing uses a P2WPKH seller address", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestSellQuote({
        price: 1000,
        sellerAddress: "bc1qseller",
        listingType: "ordinal",
        assetUtxoId: "utxo:0",
      }),
    ).toThrow("P2TR seller address");
  });

  it("auto-fills sellerPubkey for the signer's P2TR address", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        swap_psbt: "70736274ff",
        swap_inputs_to_sign: [0],
        fee_psbt: null,
        fee_inputs_to_sign: [],
        fee_payment_id: "fp_1",
        fee_waived: false,
        asset_utxo_id: "utxo:0",
        asset_utxo_value: 600,
        prep_psbt: null,
        prep_inputs_to_sign: [],
        prep_kind: null,
      },
    });
    const client = new HorizonMarketClient({
      signer: makeSigner({ p2tr: "bc1pseller", xOnlyPubkey: "aabbccdd" }),
      network: "mainnet",
      fetch: fetchFn,
    });

    await client.requestSellQuote({
      price: 1000,
      sellerAddress: "bc1pseller",
      listingType: "ordinal",
      assetUtxoId: "utxo:0",
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.seller_pubkey).toBe("aabbccdd");
  });

  it('throws when assetName is "ZELD" without listingType "zeld"', () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestSellQuote({
        price: 1000,
        sellerAddress: "bc1qseller",
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
      }),
    ).toThrow('listingType: "zeld"');
  });

  it("throws when feeUtxoIds and autoSelectFeeUtxos are both set", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestSellQuote({
        price: 1000,
        sellerAddress: "bc1qseller",
        listingType: "counterparty",
        assetName: "RAREPEPE",
        assetQuantity: 1n,
        assetUtxoId: "utxo:0",
        feeUtxoIds: ["tx:0"],
        autoSelectFeeUtxos: true,
      }),
    ).toThrow("mutually exclusive");
  });
});

describe("HorizonMarketClient.requestBuyQuote", () => {
  it("throws when swapIds is empty", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestBuyQuote({
        swapIds: [],
        buyerAddress: "bc1qbuyer",
      }),
    ).toThrow("At least one swapId is required");
  });

  it("throws when buyerAddress is not P2WPKH", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestBuyQuote({
        swapIds: ["swap_abc"],
        buyerAddress: "bc1pinscription",
      }),
    ).toThrow("P2WPKH");
  });

  it("throws when fundingUtxoIds and autoSelect are both set", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.requestBuyQuote({
        swapIds: ["swap_abc"],
        buyerAddress: "bc1qbuyer",
        fundingUtxoIds: ["tx:0"],
        autoSelect: true,
      }),
    ).toThrow("mutually exclusive");
  });
});

describe("HorizonMarketClient.requestFeeQuote", () => {
  it("throws for ZELD fee quote on testnet", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
    });

    expect(() =>
      client.requestFeeQuote({ type: "zeld", address: "bc1qseller" }),
    ).toThrow("ZELD listings are only supported on mainnet");
  });
});

describe("HorizonMarketClient.purchaseSwaps", () => {
  it("throws when buyerAddress is not P2WPKH", () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });

    expect(() =>
      client.purchaseSwaps({
        swapIds: ["swap_abc"],
        buyerAddress: "bc1pinscription",
        psbtHex: "70736274ff",
      }),
    ).toThrow("P2WPKH");
  });
});
