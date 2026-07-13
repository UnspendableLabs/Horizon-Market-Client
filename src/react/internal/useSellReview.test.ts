// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useSellReview } from "./useSellReview.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";
import type { AssetOption } from "../hooks/useAssets.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const FEES = {
  fastestFee: 30,
  halfHourFee: 20,
  hourFee: 10,
  economyFee: 5,
  minimumFee: 1,
};

function jsonRes(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Serves the mempool prices + recommended-fees endpoints useSellReview reads. */
function makeFetch(
  opts: { usd?: number; fees?: typeof FEES | "reject" } = {},
): typeof globalThis.fetch {
  const { usd = 60000, fees = FEES } = opts;
  return vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("/v1/prices")) return jsonRes({ USD: usd });
    if (u.includes("/v1/fees/recommended")) {
      return fees === "reject"
        ? Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
          } as Response)
        : jsonRes(fees);
    }
    return jsonRes({});
  }) as unknown as typeof globalThis.fetch;
}

const cpAsset: AssetOption = {
  type: "counterparty",
  assetName: "PEPE",
  address: "bc1qseller",
  balance: 100n,
  quantityNormalized: "100",
  divisible: false,
};
const korAsset: AssetOption = { type: "kor", address: "kontor1kor", amount: "100" };
const nftAsset: AssetOption = {
  type: "kontor-nft",
  nftId: "nft-abc",
  contractAddress: "c@1.2",
  address: "kontor1nft",
};

function cpForm(over: Partial<SellOrderFormValues> = {}): SellOrderFormValues {
  return { asset: cpAsset, quantity: "5", priceSats: "10000", ...over };
}

function sellQuote(over: Record<string, unknown> = {}) {
  return {
    swapPsbt: "70",
    swapInputsToSign: [0],
    feePsbt: null,
    feeInputsToSign: [],
    feePaymentId: null,
    feeWaived: false,
    assetUtxoId: "tx:0",
    assetUtxoValue: 546,
    prepPsbt: null,
    prepInputsToSign: [],
    prepKind: null,
    listingFeeSats: 2000,
    attachFeeSats: 500,
    networkFeeSats: 300,
    ...over,
  };
}

describe("useSellReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("composes a non-Kontor listing cost breakdown", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue(sellQuote());
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });
    await waitFor(() => expect(result.current.cost).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.isKontor).toBe(false);
    expect(result.current.cost).toEqual({
      listing: 2000,
      attach: 500,
      network: 300,
      total: 2800,
    });
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.paidWithCredit).toBe(false);
    expect(result.current.canSign).toBe(true);
    expect(result.current.kontorListingSats).toBeNull();
    expect(result.current.kontorListingLoading).toBe(false);
    expect(result.current.kontorListingError).toBeNull();
    expect(result.current.kontorMinerFeeSats).toBeNull();
    expect(result.current.kontorTotalSats).toBeNull();
    expect(result.current.btcUsd).toBe(60000);
  });

  it("selects fee options (slow/normal/fast) off the live estimates", async () => {
    ctxRef.current = makeCtx({
      client: { requestSellQuote: vi.fn() },
      fetch: makeFetch(),
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: false, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.feeOption).toBe("normal");
    expect(result.current.feeRate).toBe(20);
    expect(result.current.rateFor("slow")).toBe(10);
    expect(result.current.rateFor("normal")).toBe(20);
    expect(result.current.rateFor("fast")).toBe(30);

    await act(async () => result.current.setFeeOption("slow"));
    expect(result.current.feeRate).toBe(10);
    await act(async () => result.current.setFeeOption("fast"));
    expect(result.current.feeRate).toBe(30);
  });

  it("blocks Sign when the PSBT cost preview fails", async () => {
    const requestSellQuote = vi
      .fn()
      .mockRejectedValue(new Error("insufficient BTC"));
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.previewError).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.canSign).toBe(false);
    expect(result.current.cost).toBeNull();
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.paidWithCredit).toBe(false);
  });

  it("marks a waived PSBT fee as paid with a credit when the account holds one", async () => {
    const requestSellQuote = vi
      .fn()
      .mockResolvedValue(sellQuote({ feeWaived: true, listingFeeSats: 0 }));
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
      credits: 2,
      freeCredits: 0,
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.cost).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.feeWaived).toBe(true);
    expect(result.current.paidWithCredit).toBe(true);
  });

  it("does not mark a waived fee as credit-paid without any credits", async () => {
    const requestSellQuote = vi
      .fn()
      .mockResolvedValue(sellQuote({ feeWaived: true }));
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
      credits: 0,
      freeCredits: 0,
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.feeWaived).toBe(true), {
      timeout: 2000,
    });
    expect(result.current.paidWithCredit).toBe(false);
  });

  it("returns null params (no quote) when no asset is selected", async () => {
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
    });

    const { result } = renderHook(() =>
      useSellReview({
        formValues: cpForm({ asset: null }),
        active: true,
        defaultSatsPerVbyte: 7,
      }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.isKontor).toBe(false);
    expect(result.current.cost).toBeNull();
    expect(result.current.canSign).toBe(true);
    expect(result.current.kontorListingSats).toBeNull();
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("swallows a build error (invalid price) and quotes nothing", async () => {
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({
      client: { requestSellQuote },
      fetch: makeFetch(),
    });

    const { result } = renderHook(() =>
      useSellReview({
        formValues: cpForm({ priceSats: "0" }),
        active: true,
        defaultSatsPerVbyte: 7,
      }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.cost).toBeNull();
    expect(result.current.canSign).toBe(true);
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("Kontor KOR: listing fee preview + calibrated attach miner-fee estimate", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockResolvedValue({ sats: 3000, feeWaived: false });
    const listSwaps = vi.fn().mockResolvedValue({ atomicSwaps: [] });
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({
      client: { previewKontorListingFee, listSwaps, requestSellQuote },
      fetch: makeFetch(),
    });
    const form: SellOrderFormValues = {
      asset: korAsset,
      quantity: "50",
      priceSats: "8000",
    };

    const { result } = renderHook(() =>
      useSellReview({ formValues: form, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });
    await waitFor(() => expect(result.current.kontorListingSats).toBe(3000), {
      timeout: 2000,
    });
    // (fallback token reveal vsize 227 + commit 154) × 20 sat/vB.
    await waitFor(() => expect(result.current.kontorMinerFeeSats).toBe(7620), {
      timeout: 2000,
    });

    expect(result.current.isKontor).toBe(true);
    expect(result.current.kontorTotalSats).toBe(10620);
    expect(result.current.canSign).toBe(true);
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.cost).toBeNull();
    expect(previewKontorListingFee).toHaveBeenCalledWith(
      "kontor1kor",
      expect.anything(),
    );
    expect(listSwaps).toHaveBeenCalled();
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("Kontor NFT: waived listing fee → paid with credit, nft-kind estimate", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockResolvedValue({ sats: 1000, feeWaived: true });
    const listSwaps = vi.fn().mockResolvedValue({ atomicSwaps: [] });
    ctxRef.current = makeCtx({
      client: { previewKontorListingFee, listSwaps, requestSellQuote: vi.fn() },
      fetch: makeFetch(),
    });
    const form: SellOrderFormValues = {
      asset: nftAsset,
      quantity: "",
      priceSats: "12000",
    };

    const { result } = renderHook(() =>
      useSellReview({ formValues: form, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });
    await waitFor(() => expect(result.current.kontorListingSats).toBe(1000), {
      timeout: 2000,
    });
    // (fallback nft reveal vsize 216 + commit 154) × 20 sat/vB.
    await waitFor(() => expect(result.current.kontorMinerFeeSats).toBe(7400), {
      timeout: 2000,
    });

    expect(result.current.kontorTotalSats).toBe(8400);
    expect(result.current.feeWaived).toBe(true);
    expect(result.current.paidWithCredit).toBe(true); // default ctx holds credits
    expect(previewKontorListingFee).toHaveBeenCalledWith(
      "kontor1nft",
      expect.anything(),
    );
  });

  it("Kontor: blocks Sign when the listing-fee preview fails", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockRejectedValue(new Error("no payment"));
    const listSwaps = vi.fn().mockResolvedValue({ atomicSwaps: [] });
    ctxRef.current = makeCtx({
      client: { previewKontorListingFee, listSwaps, requestSellQuote: vi.fn() },
      fetch: makeFetch(),
    });
    const form: SellOrderFormValues = {
      asset: korAsset,
      quantity: "10",
      priceSats: "5000",
    };

    const { result } = renderHook(() =>
      useSellReview({ formValues: form, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(
      () => expect(result.current.kontorListingError).not.toBeNull(),
      { timeout: 2000 },
    );

    expect(result.current.canSign).toBe(false);
    expect(result.current.kontorListingSats).toBeNull();
  });

  it("falls back to the caller's default fee rate until estimates load", async () => {
    ctxRef.current = makeCtx({
      client: { requestSellQuote: vi.fn() },
      fetch: makeFetch({ fees: "reject" }),
      // A network whose fee cache is never warmed by the other tests.
      network: "testnet",
      kontorNetwork: undefined,
    });

    const { result } = renderHook(() =>
      useSellReview({ formValues: cpForm(), active: false, defaultSatsPerVbyte: 9 }),
    );
    await waitFor(() => expect(result.current.feeRate).toBe(9));

    expect(result.current.estimates).toBeNull();
    expect(result.current.rateFor("normal")).toBeUndefined();
  });
});
