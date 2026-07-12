import { describe, it, expect, vi } from "vitest";
import { fetchBtcBalanceSats } from "./btc-balance.js";

const BASE = "https://mempool.example/api";

interface Stats {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

function stubFetch(byAddr: Record<string, Stats>): typeof globalThis.fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    const addr = decodeURIComponent(url.split("/address/")[1] ?? "");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(byAddr[addr]),
    } as Response);
  }) as typeof globalThis.fetch;
}

describe("fetchBtcBalanceSats", () => {
  it("sums (funded − spent) across chain + mempool and across addresses", async () => {
    const fetchImpl = stubFetch({
      a: {
        chain_stats: { funded_txo_sum: 100_000, spent_txo_sum: 40_000 },
        mempool_stats: { funded_txo_sum: 5_000, spent_txo_sum: 1_000 },
      },
      b: {
        chain_stats: { funded_txo_sum: 20_000, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      },
    });
    // a: (100k-40k)+(5k-1k)=64k ; b: 20k ; total 84k
    expect(await fetchBtcBalanceSats(fetchImpl, BASE, ["a", "b"])).toBe(84_000n);
  });

  it("de-duplicates repeated addresses (counts each once)", async () => {
    const stats: Stats = {
      chain_stats: { funded_txo_sum: 10_000, spent_txo_sum: 0 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
    };
    const fetchImpl = stubFetch({ a: stats });
    const spy = vi.fn(fetchImpl);
    const total = await fetchBtcBalanceSats(
      spy as unknown as typeof globalThis.fetch,
      BASE,
      ["a", "a", "a"],
    );
    expect(total).toBe(10_000n);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores empty address entries", async () => {
    const fetchImpl = stubFetch({
      a: {
        chain_stats: { funded_txo_sum: 7_000, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      },
    });
    expect(await fetchBtcBalanceSats(fetchImpl, BASE, ["a", ""])).toBe(7_000n);
  });
});
