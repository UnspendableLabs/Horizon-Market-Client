// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useSellQuotePreview } from "./useSellQuotePreview.js";
import type { OpenSellOrderParams } from "../../workflows/sell.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

/** A counterparty PSBT sell-order params object (the shape the hook quotes). */
function cpParams(over: Record<string, unknown> = {}): OpenSellOrderParams {
  return {
    priceSats: 10000,
    autoSelectFeeUtxos: true,
    listingType: "counterparty",
    assetName: "XCP",
    assetQuantity: 5n,
    sellerAddress: "bc1qseller",
    ...over,
  } as unknown as OpenSellOrderParams;
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

describe("useSellQuotePreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays idle when params are null", async () => {
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() => useSellQuotePreview(null, 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cost).toBeNull();
    expect(result.current.feeWaived).toBe(false);
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("stays idle for Kontor listings", async () => {
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestSellQuote } });
    const params = {
      listingType: "kontor",
      priceSats: 1,
      kontorAssetKind: "token",
      korAmount: "1",
    } as unknown as OpenSellOrderParams;

    const { result } = renderHook(() => useSellQuotePreview(params, 5, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("stays idle when disabled", async () => {
    const requestSellQuote = vi.fn();
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams(), 5, false),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestSellQuote).not.toHaveBeenCalled();
  });

  it("stays idle when the client is unauthenticated", async () => {
    ctxRef.current = makeCtx({ client: null });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams(), 5, true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cost).toBeNull();
  });

  it("composes the sell quote into a cost breakdown", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue(
      sellQuote({ listingFeeSats: 2000, attachFeeSats: 500, networkFeeSats: 300, feeWaived: false }),
    );
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams({ assetQuantity: 5n }), 11, true),
    );
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 2000,
    });
    expect(result.current.cost).toEqual({
      listing: 2000,
      attach: 500,
      network: 300,
      total: 2800,
    });
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.error).toBeNull();
    expect(requestSellQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 10000,
        sellerAddress: "bc1qseller",
        listingType: "counterparty",
        assetName: "XCP",
        assetQuantity: 5n,
        autoSelectFeeUtxos: true,
        satsPerVbyte: 11,
        preview: true,
      }),
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("defaults missing fee fields to 0 and reports a waived fee", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue(
      sellQuote({
        listingFeeSats: null,
        attachFeeSats: null,
        networkFeeSats: null,
        feeWaived: true,
      }),
    );
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams({ sellerAddress: "bc1qwaived" }), 5, true),
    );
    await waitFor(() => expect(result.current.cost).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.cost).toEqual({
      listing: 0,
      attach: 0,
      network: 0,
      total: 0,
    });
    expect(result.current.feeWaived).toBe(true);
  });

  it("omits satsPerVbyte when the fee rate is undefined", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue(sellQuote());
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams({ sellerAddress: "bc1qnorate" }), undefined, true),
    );
    await waitFor(() => expect(result.current.cost).not.toBeNull(), {
      timeout: 2000,
    });
    expect(requestSellQuote.mock.calls[0][0]).not.toHaveProperty("satsPerVbyte");
  });

  it("surfaces an error when the quote fails", async () => {
    const requestSellQuote = vi
      .fn()
      .mockRejectedValue(new Error("no fee utxos"));
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams({ sellerAddress: "bc1qerr" }), 5, true),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.error?.message).toContain("no fee utxos");
    expect(result.current.cost).toBeNull();
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("wraps a non-Error rejection in an Error", async () => {
    const requestSellQuote = vi.fn().mockRejectedValue("kaboom");
    ctxRef.current = makeCtx({ client: { requestSellQuote } });

    const { result } = renderHook(() =>
      useSellQuotePreview(cpParams({ sellerAddress: "bc1qstr" }), 5, true),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("kaboom");
  });

  it("re-quotes when the fee rate changes", async () => {
    const requestSellQuote = vi.fn().mockResolvedValue(sellQuote());
    ctxRef.current = makeCtx({ client: { requestSellQuote } });
    const params = cpParams({ sellerAddress: "bc1qrecompute" });

    const { result, rerender } = renderHook(
      ({ rate }) => useSellQuotePreview(params, rate, true),
      { initialProps: { rate: 5 } },
    );
    await waitFor(() => expect(result.current.cost).not.toBeNull(), {
      timeout: 2000,
    });
    expect(requestSellQuote).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ rate: 30 });
    });
    await waitFor(() => expect(requestSellQuote).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    expect(requestSellQuote.mock.calls[1][0]).toMatchObject({ satsPerVbyte: 30 });
  });
});
