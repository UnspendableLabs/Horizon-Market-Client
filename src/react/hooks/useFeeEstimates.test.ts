// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useFeeEstimates } from "./useFeeEstimates.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function feesResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
}

// useFeeEstimates keeps a module-level 60s cache keyed by the network's mempool
// base URL. Advance a fake clock past the TTL between tests so a cache written by
// one test is stale for the next (even when both use the same network).
let clock = 2_000_000_000_000;

describe("useFeeEstimates", () => {
  beforeEach(() => {
    clock += 10 * 60_000; // jump past the 60s TTL
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches recommended fee rates for the active network", async () => {
    const fetch = vi.fn().mockResolvedValue(
      feesResponse({
        fastestFee: 20,
        halfHourFee: 15,
        hourFee: 10,
        economyFee: 5,
        minimumFee: 2,
      }),
    );
    ctxRef.current = makeCtx({
      network: "mainnet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useFeeEstimates());
    expect(result.current.loading).toBe(true);
    expect(result.current.estimates).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.estimates).toEqual({
      fastestFee: 20,
      halfHourFee: 15,
      hourFee: 10,
      economyFee: 5,
      minimumFee: 2,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://mempool.space/api/v1/fees/recommended",
      expect.anything(),
    );
  });

  it("falls back to safe defaults for missing / invalid fields", async () => {
    const fetch = vi.fn().mockResolvedValue(
      feesResponse({
        fastestFee: Infinity, // non-finite → fallback 1
        halfHourFee: -3, // <= 0 → fallback (fastest = 1)
        hourFee: 0, // <= 0 → fallback
        economyFee: "5", // non-number → fallback 1
        minimumFee: NaN, // non-finite → fallback 1
      }),
    );
    ctxRef.current = makeCtx({
      network: "testnet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useFeeEstimates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.estimates).toEqual({
      fastestFee: 1,
      halfHourFee: 1,
      hourFee: 1,
      economyFee: 1,
      minimumFee: 1,
    });
    // testnet (no signet) → the testnet mempool base.
    expect(fetch).toHaveBeenCalledWith(
      "https://mempool.space/testnet/api/v1/fees/recommended",
      expect.anything(),
    );
  });

  it("uses the signet base when kontorNetwork is signet", async () => {
    const fetch = vi.fn().mockResolvedValue(feesResponse({ fastestFee: 3 }));
    ctxRef.current = makeCtx({
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useFeeEstimates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Missing halfHour/hour fall back to fastest (3); economy/minimum → 1.
    expect(result.current.estimates).toEqual({
      fastestFee: 3,
      halfHourFee: 3,
      hourFee: 3,
      economyFee: 1,
      minimumFee: 1,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://mempool.space/signet/api/v1/fees/recommended",
      expect.anything(),
    );
  });

  it("surfaces a fetch failure as estimates=null, loading false", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503 } as Response);
    ctxRef.current = makeCtx({
      network: "mainnet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useFeeEstimates());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.estimates).toBeNull();
  });

  it("serves a fresh cache hit on remount without refetching", async () => {
    const fetch = vi.fn().mockResolvedValue(feesResponse({ fastestFee: 9 }));
    ctxRef.current = makeCtx({
      network: "mainnet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const first = renderHook(() => useFeeEstimates());
    await waitFor(() => expect(first.result.current.estimates).not.toBeNull());

    const second = renderHook(() => useFeeEstimates());
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.estimates).toEqual(
      first.result.current.estimates,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent mounts through the in-flight request", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetch = vi
      .fn()
      .mockReturnValue(new Promise<Response>((r) => (resolveFetch = r)));
    ctxRef.current = makeCtx({
      network: "mainnet",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const first = renderHook(() => useFeeEstimates());
    const second = renderHook(() => useFeeEstimates());
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(feesResponse({ fastestFee: 4 }));
    });
    await waitFor(() =>
      expect(first.result.current.estimates?.fastestFee).toBe(4),
    );
    await waitFor(() =>
      expect(second.result.current.estimates?.fastestFee).toBe(4),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
