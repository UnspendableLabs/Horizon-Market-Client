// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useBuyReview } from "./useBuyReview.js";
import type { AtomicSwap } from "../../types/index.js";

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

/** Serves the mempool prices + recommended-fees endpoints useBuyReview reads. */
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

function makeSwap(over: Partial<AtomicSwap> = {}): AtomicSwap {
  return {
    id: "s-" + Math.random().toString(36).slice(2),
    listingType: "counterparty",
    price: 10000,
    royalty: 300,
    ...over,
  } as unknown as AtomicSwap;
}

function buyQuote(over: Record<string, unknown> = {}) {
  return {
    psbt: "70",
    inputsToSign: [0],
    feeEstimateSats: 1500,
    royaltySats: 250,
    royaltyAddress: null,
    ...over,
  };
}

describe("useBuyReview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("composes a non-Kontor buy: price + royalty + miner fee and USD total", async () => {
    const requestBuyQuote = vi
      .fn()
      .mockResolvedValue(buyQuote({ feeEstimateSats: 1500, royaltySats: 250 }));
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      fetch: makeFetch(),
    });
    const swap = makeSwap({ id: "buy-ok", price: 10000, royalty: 300 });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });
    await waitFor(() => expect(result.current.minerFeeSats).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.isKontor).toBe(false);
    expect(result.current.priceSats).toBe(10000);
    expect(result.current.royaltySats).toBe(250); // from the composed quote
    expect(result.current.minerFeeSats).toBe(1500);
    expect(result.current.totalSats).toBe(11750);
    expect(result.current.totalDisplay).toBe("11,750");
    expect(result.current.totalUsd).not.toBeNull();
    expect(result.current.canConfirm).toBe(true);
    expect(result.current.minerFeePending).toBe("—");
    expect(result.current.networkFeeHint).toContain(
      "Estimated miner fee at 20 sat/vB",
    );
    expect(result.current.btcUsd).toBe(60000);
  });

  it("selects fee options (slow/normal/fast) off the live estimates", async () => {
    ctxRef.current = makeCtx({
      client: { requestBuyQuote: vi.fn() },
      fetch: makeFetch(),
    });
    const swap = makeSwap({ id: "buy-fee" });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: false, defaultSatsPerVbyte: 7 }),
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
    expect(result.current.feeOption).toBe("slow");
    expect(result.current.feeRate).toBe(10);

    await act(async () => result.current.setFeeOption("fast"));
    expect(result.current.feeRate).toBe(30);
  });

  it("blocks Confirm and shows an em dash when the compose fails", async () => {
    const requestBuyQuote = vi
      .fn()
      .mockRejectedValue(new Error("insufficient BTC"));
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      fetch: makeFetch(),
    });
    const swap = makeSwap({ id: "buy-fail" });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.previewError).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.canConfirm).toBe(false);
    expect(result.current.totalSats).toBeNull();
    expect(result.current.totalUsd).toBeNull();
    expect(result.current.totalDisplay).toBe("—");
    expect(result.current.minerFeePending).toBe("—");
  });

  it("Kontor listing: no preview, running subtotal, confirm-time hints", async () => {
    const requestBuyQuote = vi.fn();
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      fetch: makeFetch(),
    });
    const swap = makeSwap({
      id: "buy-kontor",
      listingType: "kontor",
      price: 5000,
      royalty: 100,
    });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.estimates).not.toBeNull(), {
      timeout: 2000,
    });

    expect(result.current.isKontor).toBe(true);
    expect(result.current.canConfirm).toBe(true);
    expect(result.current.minerFeeSats).toBeNull();
    expect(result.current.royaltySats).toBe(100); // from the listing (no quote)
    expect(result.current.totalSats).toBeNull();
    expect(result.current.totalUsd).toBeNull();
    expect(result.current.totalDisplay).toBe("5,100 +");
    expect(result.current.minerFeePending).toBe("set at confirm");
    expect(result.current.networkFeeHint).toContain(
      "composed at 20 sat/vB when you confirm",
    );
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });

  it("shows loading placeholders while the quote composes", async () => {
    const requestBuyQuote = vi.fn().mockResolvedValue(buyQuote());
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      fetch: makeFetch(),
    });
    const swap = makeSwap({ id: "buy-loading" });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: true, defaultSatsPerVbyte: 7 }),
    );
    await waitFor(() => expect(result.current.previewLoading).toBe(true));
    expect(result.current.totalDisplay).toBe("…");
    expect(result.current.minerFeePending).toBe("…");

    await waitFor(() => expect(result.current.previewLoading).toBe(false), {
      timeout: 2000,
    });
  });

  it("falls back to the caller's default fee rate until estimates load", async () => {
    ctxRef.current = makeCtx({
      client: { requestBuyQuote: vi.fn() },
      fetch: makeFetch({ fees: "reject" }),
      // A network whose fee cache is never warmed by the other tests.
      network: "testnet",
      kontorNetwork: undefined,
    });
    const swap = makeSwap({ id: "buy-default-rate" });

    const { result } = renderHook(() =>
      useBuyReview({ swap, active: false, defaultSatsPerVbyte: 9 }),
    );
    await waitFor(() => expect(result.current.feeRate).toBe(9));

    expect(result.current.estimates).toBeNull();
    expect(result.current.rateFor("normal")).toBeUndefined();
    expect(result.current.networkFeeHint).toContain("9 sat/vB");
  });
});
