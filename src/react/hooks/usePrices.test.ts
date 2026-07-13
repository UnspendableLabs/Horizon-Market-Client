// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { usePrices } from "./usePrices.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function priceResponse(usd: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ USD: usd }),
  } as Response;
}

// usePrices keeps a module-level 60s cache keyed by nothing (single global URL).
// Advance a fake clock well past the TTL between tests so each test starts with a
// stale cache and performs a fresh fetch.
let clock = 1_000_000_000_000;

describe("usePrices", () => {
  beforeEach(() => {
    clock += 10 * 60_000; // jump past the 60s TTL so the prior cache is stale
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches BTC→USD, flipping loading false", async () => {
    const fetch = vi.fn().mockResolvedValue(priceResponse(62_000));
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => usePrices());
    expect(result.current.loading).toBe(true);
    expect(result.current.btcUsd).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.btcUsd).toBe(62_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://mempool.space/api/v1/prices",
      expect.anything(),
    );
  });

  it("returns null when the response omits a numeric USD field", async () => {
    const fetch = vi.fn().mockResolvedValue(priceResponse("not-a-number"));
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => usePrices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.btcUsd).toBeNull();
  });

  it("surfaces a non-ok response as btcUsd=null, loading false", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502 } as Response);
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => usePrices());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.btcUsd).toBeNull();
  });

  it("serves a fresh cache hit on remount without refetching", async () => {
    const fetch = vi.fn().mockResolvedValue(priceResponse(50_000));
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const first = renderHook(() => usePrices());
    await waitFor(() => expect(first.result.current.btcUsd).toBe(50_000));

    // Same (frozen) clock → cache is still fresh, so the second mount paints the
    // cached value synchronously and never fetches again.
    const second = renderHook(() => usePrices());
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.btcUsd).toBe(50_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent mounts through the in-flight promise", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetch = vi
      .fn()
      .mockReturnValue(new Promise<Response>((r) => (resolveFetch = r)));
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const first = renderHook(() => usePrices());
    const second = renderHook(() => usePrices());
    // Second mount reuses the pending request instead of firing its own.
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(priceResponse(71_000));
    });
    await waitFor(() => expect(first.result.current.btcUsd).toBe(71_000));
    await waitFor(() => expect(second.result.current.btcUsd).toBe(71_000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a resolution after unmount", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetch = vi
      .fn()
      .mockReturnValue(new Promise<Response>((r) => (resolveFetch = r)));
    ctxRef.current = makeCtx({
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result, unmount } = renderHook(() => usePrices());
    unmount();
    await act(async () => {
      resolveFetch(priceResponse(80_000));
      await Promise.resolve();
    });
    // No state update after unmount; the last observed value stays null.
    expect(result.current.btcUsd).toBeNull();
  });
});
