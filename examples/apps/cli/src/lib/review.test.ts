import { describe, it, expect, vi } from "vitest";
import type {
  AtomicSwap,
  HorizonMarketClient,
} from "@unspendablelabs/horizon-market-client";
import { resolveFeeRate, previewSellCost, previewBuyCost } from "./review.js";

const MEMPOOL = "https://mempool.example/api";

function feeFetch(rates: {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
}): typeof globalThis.fetch {
  return (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rates),
    } as Response)) as typeof globalThis.fetch;
}

const failingFetch = (() =>
  Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response)) as typeof globalThis.fetch;

describe("resolveFeeRate", () => {
  const rates = { fastestFee: 30, halfHourFee: 20, hourFee: 10 };

  it("passes a numeric rate through verbatim", async () => {
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, "7")).toBe(7);
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, "12.5")).toBe(12.5);
  });

  it("maps slow/normal/fast to hour/half-hour/fastest estimates", async () => {
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, "slow")).toBe(10);
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, "normal")).toBe(20);
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, "fast")).toBe(30);
  });

  it("defaults to normal when no arg is given", async () => {
    expect(await resolveFeeRate(feeFetch(rates), MEMPOOL, undefined)).toBe(20);
  });

  it("rejects a non-positive numeric rate", async () => {
    await expect(resolveFeeRate(feeFetch(rates), MEMPOOL, "0")).rejects.toMatchObject({
      code: "BAD_FEE_RATE",
    });
  });

  it("rejects an unknown keyword", async () => {
    await expect(
      resolveFeeRate(feeFetch(rates), MEMPOOL, "whenever"),
    ).rejects.toMatchObject({ code: "BAD_FEE_RATE" });
  });

  it("errors clearly when estimates are unavailable for a keyword", async () => {
    await expect(resolveFeeRate(failingFetch, MEMPOOL, "fast")).rejects.toMatchObject({
      code: "NO_FEE_ESTIMATES",
    });
  });
});

describe("previewSellCost", () => {
  it("sums listing + attach + network fees from the preview quote", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue({
      listingFeeSats: 1000,
      attachFeeSats: 300,
      networkFeeSats: 200,
      feeWaived: false,
    });
    const client = { requestSellQuote } as unknown as HorizonMarketClient;
    const cost = await previewSellCost(client, {
      price: 5000,
      sellerAddress: "bc1qseller",
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
      autoSelectFeeUtxos: true,
      satsPerVbyte: 10,
    });
    expect(cost).toEqual({
      listing: 1000,
      attach: 300,
      network: 200,
      total: 1500,
      feeWaived: false,
    });
    // preview: true must be forwarded so no order is created.
    expect(requestSellQuote).toHaveBeenCalledWith(
      expect.objectContaining({ preview: true, price: 5000, satsPerVbyte: 10 }),
    );
  });

  it("treats missing fee fields as 0", async () => {
    const client = {
      requestSellQuote: vi.fn().mockResolvedValue({ feeWaived: true }),
    } as unknown as HorizonMarketClient;
    const cost = await previewSellCost(client, {
      price: 1,
      sellerAddress: "x",
      listingType: "ordinal",
      assetUtxoId: "t:0",
    });
    expect(cost).toEqual({ listing: 0, attach: 0, network: 0, total: 0, feeWaived: true });
  });
});

describe("previewBuyCost", () => {
  const baseSwap = {
    id: "s1",
    listingType: "counterparty",
    price: 10_000,
    royalty: null,
  } as unknown as AtomicSwap;

  it("adds price + royalty + miner fee from the buy quote", async () => {
    const client = {
      requestBuyQuote: vi.fn().mockResolvedValue({ royaltySats: 500, feeEstimateSats: 800 }),
    } as unknown as HorizonMarketClient;
    const cost = await previewBuyCost(client, baseSwap, {
      buyerAddress: "bc1qbuyer",
      buyerTaprootAddress: "bc1pbuyer",
      detach: true,
      satsPerVbyte: 10,
    });
    expect(cost).toEqual({
      priceSats: 10_000,
      royaltySats: 500,
      minerFeeSats: 800,
      totalSats: 11_300,
    });
  });

  it("omits the miner fee / total for a Kontor swap (set at accept time)", async () => {
    const requestBuyQuote = vi.fn();
    const client = { requestBuyQuote } as unknown as HorizonMarketClient;
    const kontorSwap = {
      id: "k1",
      listingType: "kontor",
      price: 7_000,
      royalty: 100,
    } as unknown as AtomicSwap;
    const cost = await previewBuyCost(client, kontorSwap, {
      buyerAddress: "bc1qbuyer",
      buyerTaprootAddress: "bc1pbuyer",
      detach: true,
      satsPerVbyte: 10,
    });
    expect(cost).toEqual({
      priceSats: 7_000,
      royaltySats: 100,
      minerFeeSats: null,
      totalSats: null,
    });
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });
});
