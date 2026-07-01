import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import { mempoolApiBase } from "../internal/format.js";

/**
 * mempool.space `/address/{addr}` funding stats. Confirmed balance lives in
 * `chain_stats`, unconfirmed deltas in `mempool_stats`; the spendable balance is
 * `funded − spent` summed across both.
 */
interface AddressStats {
  chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
  mempool_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
}

function sats(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

function addressBalance(stats: AddressStats): bigint {
  const c = stats.chain_stats ?? {};
  const m = stats.mempool_stats ?? {};
  return BigInt(
    sats(c.funded_txo_sum) -
      sats(c.spent_txo_sum) +
      sats(m.funded_txo_sum) -
      sats(m.spent_txo_sum),
  );
}

async function fetchAddressBalance(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  address: string,
): Promise<bigint> {
  const res = await fetchImpl(`${base}/address/${encodeURIComponent(address)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mempool address returned ${res.status}`);
  return addressBalance((await res.json()) as AddressStats);
}

const TTL_MS = 60_000;

interface CacheEntry {
  value: bigint;
  at: number;
}

// Cache + in-flight de-dupe keyed by the network base + connected addresses, so
// the wallet dropdown summary and the wallet page share a single fetch and a
// remount within the TTL paints instantly.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<bigint>>();

export interface UseBtcBalanceResult {
  /** Spendable BTC balance in sats across all connected addresses, or null. */
  sats: bigint | null;
  /** True while the first balance fetch is in flight (no cached value yet). */
  loading: boolean;
  /** Last fetch error, or null on success / before the first fetch. */
  error: Error | null;
  /** Re-fetch the balance, bypassing the cache. */
  refresh: () => void;
}

/**
 * Spendable on-chain BTC balance (sats) for the connected wallet, summed across
 * its P2WPKH + P2TR addresses. Read from mempool.space for the active network
 * (signet shares testnet params), cached for 60s and de-duped across mounts.
 */
export function useBtcBalance(): UseBtcBalanceResult {
  const { addresses, network, kontorNetwork, fetch } = useHorizonMarket();
  const base = mempoolApiBase(network, kontorNetwork);
  const p2wpkh = addresses?.p2wpkh;
  const p2tr = addresses?.p2tr;

  const key =
    p2wpkh && `${base}|${[p2wpkh, ...(p2tr ? [p2tr] : [])].join(",")}`;

  const cached = key ? cache.get(key) : undefined;
  const fresh = cached && Date.now() - cached.at < TTL_MS ? cached.value : null;

  const [sats, setSats] = useState<bigint | null>(fresh);
  const [loading, setLoading] = useState<boolean>(Boolean(key) && fresh === null);
  const [error, setError] = useState<Error | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    (force: boolean) => {
      const seq = ++seqRef.current;
      if (!p2wpkh || !key) {
        setSats(null);
        setError(null);
        setLoading(false);
        return;
      }

      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < TTL_MS) {
        setSats(hit.value);
        setError(null);
        setLoading(false);
        return;
      }
      if (force) inflight.delete(key);

      const addrs = [p2wpkh, ...(p2tr ? [p2tr] : [])];
      setLoading(true);
      setError(null);

      let request = force ? undefined : inflight.get(key);
      if (!request) {
        request = Promise.all(
          addrs.map((a) => fetchAddressBalance(fetch, base, a)),
        )
          .then((totals) => totals.reduce((a, b) => a + b, 0n))
          .then(
            (total) => {
              cache.set(key, { value: total, at: Date.now() });
              inflight.delete(key);
              return total;
            },
            (err) => {
              inflight.delete(key);
              throw err;
            },
          );
        inflight.set(key, request);
      }

      request
        .then((total) => {
          if (seq !== seqRef.current) return;
          setSats(total);
          setLoading(false);
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
    },
    [p2wpkh, p2tr, base, key, fetch],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { sats, loading, error, refresh };
}
