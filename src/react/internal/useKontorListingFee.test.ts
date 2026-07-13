// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useKontorListingFee } from "./useKontorListingFee.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useKontorListingFee", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is idle and does not fetch when disabled", async () => {
    const previewKontorListingFee = vi.fn();
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1pfee", false),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.listingSats).toBeNull();
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.error).toBeNull();
    expect(previewKontorListingFee).not.toHaveBeenCalled();
  });

  it("is idle when the address is null", async () => {
    const previewKontorListingFee = vi.fn();
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() => useKontorListingFee(null, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.listingSats).toBeNull();
    expect(previewKontorListingFee).not.toHaveBeenCalled();
  });

  it("is idle when the client is not initialized", async () => {
    ctxRef.current = makeCtx({ client: null });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1pfee", true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.listingSats).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves the listing fee for an address", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockResolvedValue({ sats: 2500, feeWaived: false });
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1psuccess", true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.listingSats).toBe(2500);
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.error).toBeNull();
    expect(previewKontorListingFee).toHaveBeenCalledWith(
      "bc1psuccess",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("reports a waived fee (0 sats) when covered by a credit", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockResolvedValue({ sats: 0, feeWaived: true });
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1pwaived", true),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.listingSats).toBe(0);
    expect(result.current.feeWaived).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an Error thrown by the preview request", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockRejectedValue(new Error("preview failed"));
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1perror", true),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toBe("preview failed");
    expect(result.current.listingSats).toBeNull();
    expect(result.current.feeWaived).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("wraps a non-Error rejection into an Error", async () => {
    const previewKontorListingFee = vi.fn().mockRejectedValue("boom");
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1pstring", true),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("boom");
  });

  it("is loading while the preview request is in flight", async () => {
    const d = deferred<{ sats: number; feeWaived: boolean }>();
    const previewKontorListingFee = vi.fn().mockReturnValue(d.promise);
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result } = renderHook(() =>
      useKontorListingFee("bc1ppending", true),
    );
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.listingSats).toBeNull();

    d.resolve({ sats: 999, feeWaived: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listingSats).toBe(999);
  });

  it("recomputes when the address changes", async () => {
    const previewKontorListingFee = vi
      .fn()
      .mockResolvedValueOnce({ sats: 100, feeWaived: false })
      .mockResolvedValueOnce({ sats: 200, feeWaived: false });
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result, rerender } = renderHook(
      ({ address }) => useKontorListingFee(address, true),
      { initialProps: { address: "bc1pfirst" } },
    );
    await waitFor(() => expect(result.current.listingSats).toBe(100));

    rerender({ address: "bc1psecond" });
    await waitFor(() => expect(result.current.listingSats).toBe(200));
    expect(previewKontorListingFee).toHaveBeenCalledTimes(2);
    expect(previewKontorListingFee).toHaveBeenLastCalledWith(
      "bc1psecond",
      expect.anything(),
    );
  });

  it("ignores a stale response when the address changes mid-flight", async () => {
    const first = deferred<{ sats: number; feeWaived: boolean }>();
    const second = deferred<{ sats: number; feeWaived: boolean }>();
    const previewKontorListingFee = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    ctxRef.current = makeCtx({ client: { previewKontorListingFee } as never });

    const { result, rerender } = renderHook(
      ({ address }) => useKontorListingFee(address, true),
      { initialProps: { address: "bc1pold" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    rerender({ address: "bc1pnew" });
    // The stale (old) request resolves last but must not overwrite the new one.
    second.resolve({ sats: 555, feeWaived: false });
    first.resolve({ sats: 111, feeWaived: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listingSats).toBe(555);
    expect(result.current.feeWaived).toBe(false);
  });
});
