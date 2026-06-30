import { useEffect, useState } from "react";
import { useHorizonMarket } from "../context.js";
import { mempoolApiBase } from "../internal/format.js";

/** Recommended sat/vByte fee rates from mempool.space `/v1/fees/recommended`. */
export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

const TTL_MS = 60_000;

interface FeeCacheEntry {
  value: FeeEstimates;
  at: number;
}

// Cache + in-flight de-dupe keyed by the network's mempool base URL.
const cache = new Map<string, FeeCacheEntry>();
const inflight = new Map<string, Promise<FeeEstimates>>();

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

async function fetchFees(
  fetchImpl: typeof globalThis.fetch,
  base: string,
): Promise<FeeEstimates> {
  const res = await fetchImpl(`${base}/v1/fees/recommended`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mempool fees returned ${res.status}`);
  const b = (await res.json()) as Partial<FeeEstimates>;
  const fastest = num(b.fastestFee, 1);
  return {
    fastestFee: fastest,
    halfHourFee: num(b.halfHourFee, fastest),
    hourFee: num(b.hourFee, num(b.halfHourFee, fastest)),
    economyFee: num(b.economyFee, 1),
    minimumFee: num(b.minimumFee, 1),
  };
}

export interface UseFeeEstimatesResult {
  estimates: FeeEstimates | null;
  loading: boolean;
}

/**
 * Live mempool.space recommended fee rates for the active network, used to
 * populate the sell review's fee-rate selector. Cached for 60s per network and
 * de-duped across components.
 */
export function useFeeEstimates(): UseFeeEstimatesResult {
  const { network, kontorNetwork, fetch } = useHorizonMarket();
  const base = mempoolApiBase(network, kontorNetwork);

  const cached = (() => {
    const hit = cache.get(base);
    return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
  })();

  const [estimates, setEstimates] = useState<FeeEstimates | null>(cached);
  const [loading, setLoading] = useState<boolean>(cached === null);

  useEffect(() => {
    let alive = true;

    const hit = cache.get(base);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setEstimates(hit.value);
      setLoading(false);
      return;
    }

    setLoading(true);
    let request = inflight.get(base);
    if (!request) {
      request = fetchFees(fetch, base).then(
        (v) => {
          cache.set(base, { value: v, at: Date.now() });
          inflight.delete(base);
          return v;
        },
        (err) => {
          inflight.delete(base);
          throw err;
        },
      );
      inflight.set(base, request);
    }

    request
      .then((v) => {
        if (!alive) return;
        setEstimates(v);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setEstimates(null);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [base, fetch]);

  return { estimates, loading };
}
