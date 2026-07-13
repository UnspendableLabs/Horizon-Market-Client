// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useBtcBalance } from "./useBtcBalance.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function addrResponse(funded: number, spent: number) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      }),
  } as Response;
}

describe("useBtcBalance", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sums spendable balance across the P2WPKH and P2TR addresses", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(addrResponse(100_000, 40_000)) // p2wpkh: 60k
      .mockResolvedValueOnce(addrResponse(30_000, 5_000)); // p2tr: 25k
    // Unique addresses so the module-level cache can't collide across tests.
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qsum", p2tr: "bc1psum", publicKey: "02cc" },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useBtcBalance());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sats).toBe(85_000n);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    // signet/testnet share params; mainnet default here → mainnet mempool base.
    expect(fetch).toHaveBeenCalledWith(
      "https://mempool.space/api/address/bc1qsum",
      expect.anything(),
    );
  });

  it("returns null and does not fetch when no wallet is connected", async () => {
    const fetch = vi.fn();
    ctxRef.current = makeCtx({
      addresses: null,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useBtcBalance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sats).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces an error when the mempool request fails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response);
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qerr", p2tr: "bc1perr", publicKey: "02dd" },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useBtcBalance());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain("500");
    expect(result.current.sats).toBeNull();
  });

  it("refresh() re-fetches bypassing the cache", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(addrResponse(100_000, 0))
      .mockResolvedValueOnce(addrResponse(50_000, 0))
      .mockResolvedValueOnce(addrResponse(10_000, 0))
      .mockResolvedValueOnce(addrResponse(10_000, 0));
    // Unique addresses so this test's cache key can't collide with others.
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qrefresh", p2tr: "bc1prefresh", publicKey: "02bb" },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useBtcBalance());
    await waitFor(() => expect(result.current.sats).toBe(150_000n));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.sats).toBe(20_000n));
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
