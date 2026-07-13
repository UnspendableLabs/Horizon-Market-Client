// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { CLIENT_NOT_INITIALIZED } from "../internal/format.js";
import type { AssetOption } from "./useAssets.js";
import { useSellOrder } from "./useSellOrder.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

// A valid divisible fungible listing fixture (mirrors sellFormValidation.test).
const zeld: AssetOption = {
  type: "zeld",
  address: "bc1qseller",
  balance: 100_000_000n, // 1 ZELD
  quantityNormalized: "1.00000000",
  divisible: true,
};

type SellResult = ReturnType<typeof useSellOrder>;

/** Fill the form with a valid listing and advance to the confirm step. */
function fillAndSubmit(result: { current: SellResult }): void {
  act(() => {
    result.current.setFormValues({
      asset: zeld,
      quantity: "0.5",
      priceSats: "1000",
    });
  });
  act(() => {
    result.current.submitForm();
  });
}

const okResult = {
  swap: { id: "swap-1" },
  created: true,
  transactions: [],
};

/** openSellOrder mock that emits two progress events then resolves. */
function successfulOpen() {
  return vi.fn(
    async (
      _params: unknown,
      opts?: { onProgress?: (e: unknown) => void },
    ) => {
      opts?.onProgress?.({ message: "quote", stepIndex: 1, totalSteps: null });
      opts?.onProgress?.({ message: "sign", stepIndex: 2, totalSteps: 3 });
      return okResult;
    },
  );
}

describe("useSellOrder", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx({ client: { openSellOrder: successfulOpen() } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts on the form step in an idle state", () => {
    const { result } = renderHook(() => useSellOrder());
    expect(result.current.step).toBe("form");
    expect(result.current.status).toBe("idle");
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.formValues).toEqual({
      asset: null,
      quantity: "",
      priceSats: "",
    });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.steps).toEqual([]);
    expect(result.current.totalSteps).toBeNull();
  });

  it("seeds the form with initialAsset", () => {
    const { result } = renderHook(() => useSellOrder({ initialAsset: zeld }));
    expect(result.current.formValues.asset).toBe(zeld);
  });

  it("setFormValues merges partials, accepts a function updater, and clears errors", () => {
    const { result } = renderHook(() => useSellOrder());

    // Submit with no asset → validation error.
    act(() => result.current.submitForm());
    expect(result.current.error).not.toBeNull();
    expect(result.current.step).toBe("form");

    act(() => result.current.setFormValues({ quantity: "2" }));
    expect(result.current.formValues.quantity).toBe("2");
    expect(result.current.error).toBeNull();

    act(() =>
      result.current.setFormValues((prev) => ({ ...prev, priceSats: "500" })),
    );
    expect(result.current.formValues.priceSats).toBe("500");
    expect(result.current.formValues.quantity).toBe("2");
  });

  it("submitForm advances to confirm for a valid form", () => {
    const { result } = renderHook(() => useSellOrder());
    fillAndSubmit(result);
    expect(result.current.step).toBe("confirm");
    expect(result.current.error).toBeNull();
  });

  it("confirmAndSell runs the workflow to a successful result", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSellOrder({ onSuccess }));
    fillAndSubmit(result);

    await act(async () => {
      await result.current.confirmAndSell();
    });

    expect(result.current.status).toBe("success");
    expect(result.current.step).toBe("result");
    expect(result.current.result?.swap).toEqual({ id: "swap-1" });
    expect(result.current.steps).toHaveLength(2);
    expect(result.current.totalSteps).toBe(3);
    expect(result.current.isSubmitting).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith({ id: "swap-1" }, true);
    expect(ctxRef.current!.refreshCredits).toHaveBeenCalled();
  });

  it("confirmAndSell applies the satsPerVbyte override to the workflow params", async () => {
    const openSellOrder = successfulOpen();
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder());
    fillAndSubmit(result);

    await act(async () => {
      await result.current.confirmAndSell({ satsPerVbyte: 7 });
    });

    expect(openSellOrder).toHaveBeenCalledTimes(1);
    expect(
      (openSellOrder.mock.calls[0][0] as { satsPerVbyte?: number }).satsPerVbyte,
    ).toBe(7);
  });

  it("confirmAndSell errors when the form was never submitted", async () => {
    const onError = vi.fn();
    const openSellOrder = successfulOpen();
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder({ onError }));

    await act(async () => {
      await result.current.confirmAndSell();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.step).toBe("result");
    expect(result.current.error?.message).toBe("Form not submitted");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(openSellOrder).not.toHaveBeenCalled();
  });

  it("confirmAndSell errors when the client is not initialized", async () => {
    const onError = vi.fn();
    const ctx = makeCtx();
    ctx.client = null as unknown as typeof ctx.client;
    ctxRef.current = ctx;
    const { result } = renderHook(() => useSellOrder({ onError }));
    fillAndSubmit(result);

    await act(async () => {
      await result.current.confirmAndSell();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.step).toBe("result");
    expect(result.current.error?.message).toBe(CLIENT_NOT_INITIALIZED);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("confirmAndSell surfaces a workflow failure", async () => {
    const onError = vi.fn();
    const openSellOrder = vi
      .fn()
      .mockRejectedValue(new Error("chain broadcast failed"));
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder({ onError }));
    fillAndSubmit(result);

    await act(async () => {
      await result.current.confirmAndSell();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.step).toBe("result");
    expect(result.current.error?.message).toBe("chain broadcast failed");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ctxRef.current!.refreshCredits).not.toHaveBeenCalled();
  });

  it("goBack returns to the form from confirm and from an error result", async () => {
    const openSellOrder = vi.fn().mockRejectedValue(new Error("fail"));
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder());

    // No-op on the form step.
    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");

    // confirm → form.
    fillAndSubmit(result);
    expect(result.current.step).toBe("confirm");
    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");

    // error result → form (clears the error).
    fillAndSubmit(result);
    await act(async () => {
      await result.current.confirmAndSell();
    });
    expect(result.current.step).toBe("result");
    expect(result.current.status).toBe("error");
    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");
    expect(result.current.error).toBeNull();
  });

  it("retry re-runs the workflow only after an error", async () => {
    const openSellOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(okResult);
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder());

    // retry is a no-op while idle.
    act(() => result.current.retry());
    expect(openSellOrder).not.toHaveBeenCalled();

    fillAndSubmit(result);
    await act(async () => {
      await result.current.confirmAndSell();
    });
    expect(result.current.status).toBe("error");

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(openSellOrder).toHaveBeenCalledTimes(2);
  });

  it("reset clears the whole flow", async () => {
    const { result } = renderHook(() => useSellOrder());
    fillAndSubmit(result);
    await act(async () => {
      await result.current.confirmAndSell();
    });
    expect(result.current.status).toBe("success");

    act(() => result.current.reset());
    expect(result.current.step).toBe("form");
    expect(result.current.status).toBe("idle");
    expect(result.current.formValues).toEqual({
      asset: null,
      quantity: "",
      priceSats: "",
    });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.steps).toEqual([]);
    expect(result.current.totalSteps).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("ignores a re-entrant confirmAndSell while one is in flight", async () => {
    let resolveSell!: (v: unknown) => void;
    const openSellOrder = vi.fn(
      () => new Promise((r) => (resolveSell = r as (v: unknown) => void)),
    );
    ctxRef.current = makeCtx({ client: { openSellOrder } });
    const { result } = renderHook(() => useSellOrder());
    fillAndSubmit(result);

    await act(async () => {
      const p1 = result.current.confirmAndSell();
      const p2 = result.current.confirmAndSell();
      resolveSell(okResult);
      await Promise.all([p1, p2]);
    });

    expect(openSellOrder).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("success");
  });
});
