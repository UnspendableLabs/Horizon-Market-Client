// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useBuyQuotePreview } from "./useBuyQuotePreview.js";
import type { AtomicSwap } from "../../types/index.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

// Only `id` / `listingType` are read by the hook — the rest of AtomicSwap is
// irrelevant here, so a loose cast keeps the fixtures small.
function makeSwap(over: Partial<AtomicSwap> = {}): AtomicSwap {
  return {
    id: "swap-" + Math.random().toString(36).slice(2),
    listingType: "counterparty",
    price: 10000,
    royalty: 300,
    ...over,
  } as unknown as AtomicSwap;
}

function buyQuote(over: Record<string, unknown> = {}) {
  return {
    psbt: "70736274ff",
    inputsToSign: [0],
    feeEstimateSats: 1500,
    royaltySats: 250,
    royaltyAddress: null,
    ...over,
  };
}

describe("useBuyQuotePreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays idle for Kontor listings (no buy-quote endpoint)", async () => {
    const requestBuyQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ listingType: "kontor" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.minerFeeSats).toBeNull();
    expect(result.current.royaltySats).toBeNull();
    expect(result.current.error).toBeNull();
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });

  it("stays idle when disabled", async () => {
    const requestBuyQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });

    const { result } = renderHook(() =>
      useBuyQuotePreview(makeSwap(), 5, false),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });

  it("stays idle when the client is unauthenticated", async () => {
    ctxRef.current = makeCtx({ client: null });

    const { result } = renderHook(() => useBuyQuotePreview(makeSwap(), 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.minerFeeSats).toBeNull();
  });

  it("stays idle when no buyer (p2wpkh) address is available", async () => {
    const requestBuyQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestBuyQuote }, addresses: null });

    const { result } = renderHook(() => useBuyQuotePreview(makeSwap(), 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });

  it("stays idle for an ordinal without a taproot receive address", async () => {
    const requestBuyQuote = vi.fn();
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      addresses: { p2wpkh: "bc1qord", p2tr: "", publicKey: "02" },
    });
    const swap = makeSwap({ listingType: "ordinal" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestBuyQuote).not.toHaveBeenCalled();
  });

  it("composes the buyer PSBT and exposes miner fee + royalty", async () => {
    const requestBuyQuote = vi
      .fn()
      .mockResolvedValue(buyQuote({ feeEstimateSats: 1500, royaltySats: 250 }));
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ id: "swap-buy-success" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 12, true));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 2000,
    });
    expect(result.current.minerFeeSats).toBe(1500);
    expect(result.current.royaltySats).toBe(250);
    expect(result.current.error).toBeNull();
    expect(requestBuyQuote).toHaveBeenCalledTimes(1);
    expect(requestBuyQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        swapIds: ["swap-buy-success"],
        buyerAddress: "bc1qwallet",
        autoSelect: true,
        detach: true,
        satsPerVbyte: 12,
      }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    // A non-ordinal listing carries no taproot address.
    expect(requestBuyQuote.mock.calls[0][0]).not.toHaveProperty(
      "buyerTaprootAddress",
    );
  });

  it("includes the taproot receive address for ordinal listings", async () => {
    const requestBuyQuote = vi.fn().mockResolvedValue(buyQuote());
    ctxRef.current = makeCtx({
      client: { requestBuyQuote },
      addresses: { p2wpkh: "bc1qordbuy", p2tr: "bc1pordbuy", publicKey: "02" },
    });
    const swap = makeSwap({ id: "swap-ord", listingType: "ordinal" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 8, true));
    await waitFor(() => expect(result.current.minerFeeSats).not.toBeNull(), {
      timeout: 2000,
    });
    expect(requestBuyQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerTaprootAddress: "bc1pordbuy",
        satsPerVbyte: 8,
      }),
      expect.anything(),
    );
  });

  it("omits satsPerVbyte when the fee rate is undefined", async () => {
    const requestBuyQuote = vi.fn().mockResolvedValue(buyQuote());
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ id: "swap-norate" });

    const { result } = renderHook(() =>
      useBuyQuotePreview(swap, undefined, true),
    );
    await waitFor(() => expect(result.current.minerFeeSats).not.toBeNull(), {
      timeout: 2000,
    });
    expect(requestBuyQuote.mock.calls[0][0]).not.toHaveProperty("satsPerVbyte");
  });

  it("surfaces an error when the compose fails", async () => {
    const requestBuyQuote = vi
      .fn()
      .mockRejectedValue(new Error("insufficient funds"));
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ id: "swap-err" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 5, true));
    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.error?.message).toContain("insufficient funds");
    expect(result.current.minerFeeSats).toBeNull();
    expect(result.current.royaltySats).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("wraps a non-Error rejection in an Error", async () => {
    const requestBuyQuote = vi.fn().mockRejectedValue("boom");
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ id: "swap-strerr" });

    const { result } = renderHook(() => useBuyQuotePreview(swap, 5, true));
    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("boom");
  });

  it("re-quotes when the fee rate changes", async () => {
    const requestBuyQuote = vi.fn().mockResolvedValue(buyQuote());
    ctxRef.current = makeCtx({ client: { requestBuyQuote } });
    const swap = makeSwap({ id: "swap-recompute" });

    const { result, rerender } = renderHook(
      ({ rate }) => useBuyQuotePreview(swap, rate, true),
      { initialProps: { rate: 5 } },
    );
    await waitFor(() => expect(result.current.minerFeeSats).not.toBeNull(), {
      timeout: 2000,
    });
    expect(requestBuyQuote).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ rate: 25 });
    });
    await waitFor(() => expect(requestBuyQuote).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    expect(requestBuyQuote.mock.calls[1][0]).toMatchObject({ satsPerVbyte: 25 });
  });
});
