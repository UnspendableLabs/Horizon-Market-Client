// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import type {
  PendingSale,
  WorkflowProgressEvent,
} from "../../types/index.js";
import {
  useSwapConfirmation,
  type UseSwapConfirmationOptions,
} from "./useSwapConfirmation.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

type Client = HorizonMarketContextValue["client"];

function sale(id: string, txId: string | null): PendingSale {
  return { txId: txId as string, buyerAddress: "bc1qbuyer", atomicSwap: { id } };
}

function fillEvent(
  step: WorkflowProgressEvent extends { step: infer S } ? S : never,
  totalSteps: number | null,
): WorkflowProgressEvent {
  return {
    workflow: "fillSwaps",
    step: step as never,
    message: "…",
    stepIndex: 1,
    totalSteps,
    phase: "start",
  } as WorkflowProgressEvent;
}

function delistEvent(totalSteps: number | null): WorkflowProgressEvent {
  return {
    workflow: "delistSwap",
    step: "signDelistMessage",
    message: "…",
    stepIndex: 1,
    totalSteps,
    phase: "start",
  };
}

function ctxWith(
  client: Record<string, unknown> | undefined,
  overrides: Partial<HorizonMarketContextValue> = {},
): HorizonMarketContextValue {
  return makeCtx({ client: client as unknown as Client, ...overrides });
}

afterEach(() => {
    vi.restoreAllMocks();
  });

describe("useSwapConfirmation — buy", () => {
  it("drives a successful purchase through progress → result", async () => {
    const fillSwaps = vi.fn().mockImplementation(async (_params, opts) => {
      opts.onProgress?.(fillEvent("validateParams", null)); // totalSteps null branch
      opts.onProgress?.(fillEvent("signBuyerPsbt", 3));
      opts.onProgress?.(fillEvent("submitPurchase", 3));
      return [sale("swap-buy-1", "tx-abc")];
    });
    const onBuySuccess = vi.fn();
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-1", mode: "buy", onBuySuccess }),
    );

    await act(async () => {
      await result.current.confirmPurchase();
    });

    expect(result.current.buyStatus).toBe("success");
    expect(result.current.status).toBe("success");
    expect(result.current.step).toBe("result");
    expect(result.current.sales).toEqual([sale("swap-buy-1", "tx-abc")]);
    expect(result.current.successMessage).toBe("Purchase complete!");
    expect(result.current.buySteps).toHaveLength(3);
    expect(result.current.steps).toHaveLength(3);
    expect(result.current.totalBuySteps).toBe(3);
    expect(result.current.totalSteps).toBe(3);
    expect(result.current.trackUrl).toBe("https://mempool.space/tx/tx-abc");
    expect(result.current.isSubmitting).toBe(false);
    expect(onBuySuccess).toHaveBeenCalledWith([sale("swap-buy-1", "tx-abc")]);

    // Passes swapId + autoSelect (no satsPerVbyte when unset).
    const params = fillSwaps.mock.calls[0][0];
    expect(params).toEqual({ swapIds: ["swap-buy-1"], autoSelect: true });
  });

  it("forwards defaultSatsPerVbyte and merges caller extras", async () => {
    const fillSwaps = vi.fn().mockResolvedValue([sale("swap-buy-2", "tx")]);
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({
        swapId: "swap-buy-2",
        mode: "buy",
        defaultSatsPerVbyte: 5,
      }),
    );

    await act(async () => {
      await result.current.confirmPurchase({ satsPerVbyte: 12 });
    });

    expect(fillSwaps.mock.calls[0][0]).toEqual({
      swapIds: ["swap-buy-2"],
      autoSelect: true,
      satsPerVbyte: 12,
    });
  });

  it("reports a buy failure and calls onError", async () => {
    const fillSwaps = vi.fn().mockRejectedValue(new Error("insufficient funds"));
    const onError = vi.fn();
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-3", mode: "buy", onError }),
    );

    await act(async () => {
      await result.current.confirmPurchase();
    });

    expect(result.current.buyStatus).toBe("error");
    expect(result.current.step).toBe("result");
    expect(result.current.error?.message).toBe("insufficient funds");
    expect(result.current.trackUrl).toBeNull();
    expect(result.current.successMessage).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("wraps a non-Error buy rejection", async () => {
    const fillSwaps = vi.fn().mockRejectedValue("kaboom");
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-4", mode: "buy" }),
    );

    await act(async () => {
      await result.current.confirmPurchase();
    });
    expect(result.current.error?.message).toBe("kaboom");
    expect(result.current.buyStatus).toBe("error");
  });

  it("errors with CLIENT_NOT_INITIALIZED when there is no client", async () => {
    const onError = vi.fn();
    ctxRef.current = makeCtx({ client: undefined });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-5", mode: "buy", onError }),
    );

    await act(async () => {
      await result.current.confirmPurchase();
    });

    expect(result.current.buyStatus).toBe("error");
    expect(result.current.step).toBe("result");
    expect(result.current.error?.message).toContain("not initialized");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("ignores a re-entrant confirmPurchase while one is in flight", async () => {
    let resolveFill!: (v: PendingSale[]) => void;
    const fillSwaps = vi
      .fn()
      .mockImplementation(
        () => new Promise<PendingSale[]>((res) => (resolveFill = res)),
      );
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-6", mode: "buy" }),
    );

    await act(async () => {
      void result.current.confirmPurchase();
    });
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      await result.current.confirmPurchase(); // guarded, returns immediately
    });
    expect(fillSwaps).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFill([sale("swap-buy-6", "tx-6")]);
    });
    await waitFor(() => expect(result.current.buyStatus).toBe("success"));
  });

  it("computes a signet track URL on the testnet+signet network", async () => {
    const fillSwaps = vi.fn().mockResolvedValue([sale("swap-buy-7", "tx-sig")]);
    ctxRef.current = ctxWith(
      { fillSwaps },
      { network: "testnet", kontorNetwork: "signet" },
    );

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-7", mode: "buy" }),
    );
    await act(async () => {
      await result.current.confirmPurchase();
    });
    expect(result.current.trackUrl).toBe(
      "https://mempool.space/signet/tx/tx-sig",
    );
  });

  it("has a null track URL when the successful buy produced no txid", async () => {
    const fillSwaps = vi.fn().mockResolvedValue([sale("swap-buy-8", null)]);
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-buy-8", mode: "buy" }),
    );
    await act(async () => {
      await result.current.confirmPurchase();
    });
    expect(result.current.buyStatus).toBe("success");
    expect(result.current.trackUrl).toBeNull();
  });
});

describe("useSwapConfirmation — delist", () => {
  it("drives a successful delist through progress → result", async () => {
    const delistSwap = vi.fn().mockImplementation(async (_id, opts) => {
      opts.onProgress?.(delistEvent(null)); // totalSteps null branch
      opts.onProgress?.(delistEvent(2));
    });
    const onDelistSuccess = vi.fn();
    ctxRef.current = ctxWith({ delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({
        swapId: "swap-del-1",
        mode: "sell",
        onDelistSuccess,
      }),
    );

    await act(async () => {
      await result.current.delist();
    });

    expect(result.current.delistStatus).toBe("success");
    expect(result.current.status).toBe("success");
    expect(result.current.step).toBe("result");
    expect(result.current.successMessage).toBe("Listing removed.");
    expect(result.current.delistSteps).toHaveLength(2);
    expect(result.current.totalDelistSteps).toBe(2);
    expect(result.current.totalSteps).toBe(2);
    // Delist never yields a track URL (buy-only).
    expect(result.current.trackUrl).toBeNull();
    expect(onDelistSuccess).toHaveBeenCalledTimes(1);
    expect(delistSwap).toHaveBeenCalledWith("swap-del-1", expect.any(Object));
  });

  it("reports a delist failure and calls onError", async () => {
    const delistSwap = vi.fn().mockRejectedValue(new Error("nope"));
    const onError = vi.fn();
    ctxRef.current = ctxWith({ delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-del-2", mode: "sell", onError }),
    );
    await act(async () => {
      await result.current.delist();
    });

    expect(result.current.delistStatus).toBe("error");
    expect(result.current.error?.message).toBe("nope");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("wraps a non-Error delist rejection", async () => {
    const delistSwap = vi.fn().mockRejectedValue("oops");
    ctxRef.current = ctxWith({ delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-del-3", mode: "sell" }),
    );
    await act(async () => {
      await result.current.delist();
    });
    expect(result.current.error?.message).toBe("oops");
  });

  it("errors with CLIENT_NOT_INITIALIZED when there is no client", async () => {
    const onError = vi.fn();
    ctxRef.current = makeCtx({ client: undefined });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-del-4", mode: "sell", onError }),
    );
    await act(async () => {
      await result.current.delist();
    });
    expect(result.current.delistStatus).toBe("error");
    expect(result.current.error?.message).toContain("not initialized");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("ignores a re-entrant delist while one is in flight", async () => {
    let resolveDelist!: () => void;
    const delistSwap = vi
      .fn()
      .mockImplementation(() => new Promise<void>((res) => (resolveDelist = res)));
    ctxRef.current = ctxWith({ delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-del-5", mode: "sell" }),
    );
    await act(async () => {
      void result.current.delist();
    });
    expect(result.current.isSubmitting).toBe(true);
    await act(async () => {
      await result.current.delist(); // guarded
    });
    expect(delistSwap).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDelist();
    });
    await waitFor(() => expect(result.current.delistStatus).toBe("success"));
  });
});

describe("useSwapConfirmation — retry / reset / swapId change", () => {
  it("retry replays the last buy action", async () => {
    const fillSwaps = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([sale("swap-r-1", "tx-r")]);
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-r-1", mode: "buy" }),
    );
    await act(async () => {
      await result.current.confirmPurchase({ satsPerVbyte: 9 });
    });
    expect(result.current.buyStatus).toBe("error");

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.buyStatus).toBe("success"));
    expect(fillSwaps).toHaveBeenCalledTimes(2);
    // Retry replays the original extra params.
    expect(fillSwaps.mock.calls[1][0]).toEqual({
      swapIds: ["swap-r-1"],
      autoSelect: true,
      satsPerVbyte: 9,
    });
  });

  it("retry replays the last delist action", async () => {
    const delistSwap = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    ctxRef.current = ctxWith({ delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-r-2", mode: "sell" }),
    );
    await act(async () => {
      await result.current.delist();
    });
    expect(result.current.delistStatus).toBe("error");

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.delistStatus).toBe("success"));
    expect(delistSwap).toHaveBeenCalledTimes(2);
  });

  it("retry is a no-op when nothing has run yet", async () => {
    const fillSwaps = vi.fn();
    const delistSwap = vi.fn();
    ctxRef.current = ctxWith({ fillSwaps, delistSwap });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-r-3", mode: "buy" }),
    );
    await act(async () => {
      result.current.retry();
    });
    expect(fillSwaps).not.toHaveBeenCalled();
    expect(delistSwap).not.toHaveBeenCalled();
    expect(result.current.buyStatus).toBe("idle");
  });

  it("reset returns to the idle confirm state after a success", async () => {
    const fillSwaps = vi.fn().mockResolvedValue([sale("swap-reset", "tx")]);
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-reset", mode: "buy" }),
    );
    await act(async () => {
      await result.current.confirmPurchase();
    });
    expect(result.current.step).toBe("result");

    await act(async () => {
      result.current.reset();
    });
    expect(result.current.step).toBe("confirm");
    expect(result.current.buyStatus).toBe("idle");
    expect(result.current.sales).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("resets its workflow state when the target swapId changes", async () => {
    const fillSwaps = vi.fn().mockResolvedValue([sale("swap-a", "tx")]);
    ctxRef.current = ctxWith({ fillSwaps });

    const { result, rerender } = renderHook(
      (props: UseSwapConfirmationOptions) => useSwapConfirmation(props),
      { initialProps: { swapId: "swap-a", mode: "buy" } },
    );
    await act(async () => {
      await result.current.confirmPurchase();
    });
    expect(result.current.buyStatus).toBe("success");

    rerender({ swapId: "swap-b", mode: "buy" });
    await waitFor(() => expect(result.current.buyStatus).toBe("idle"));
    expect(result.current.step).toBe("confirm");
    expect(result.current.sales).toBeNull();
  });

  it("initial state is idle with no success message or track URL", async () => {
    const fillSwaps = vi.fn();
    ctxRef.current = ctxWith({ fillSwaps });

    const { result } = renderHook(() =>
      useSwapConfirmation({ swapId: "swap-init", mode: "buy" }),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.step).toBe("confirm");
    expect(result.current.successMessage).toBeUndefined();
    expect(result.current.trackUrl).toBeNull();
    expect(result.current.totalSteps).toBeNull();
    expect(result.current.steps).toEqual([]);
  });
});
