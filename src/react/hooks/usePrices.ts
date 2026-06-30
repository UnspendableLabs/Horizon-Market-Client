import { useEffect, useState } from "react";
import { useHorizonMarket } from "../context.js";

/** mempool.space spot-price endpoint (mainnet pricing is used on every network). */
const PRICES_URL = "https://mempool.space/api/v1/prices";
const TTL_MS = 60_000;

interface PriceCacheEntry {
  value: number;
  at: number;
}

// Module-level cache + in-flight de-dupe so many review screens mounting at once
// share a single request, and a remount within the TTL paints instantly.
let cache: PriceCacheEntry | null = null;
let inflight: Promise<number | null> | null = null;

async function fetchBtcUsd(
  fetchImpl: typeof globalThis.fetch,
): Promise<number | null> {
  const res = await fetchImpl(PRICES_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mempool prices returned ${res.status}`);
  const body = (await res.json()) as { USD?: unknown };
  return typeof body.USD === "number" && Number.isFinite(body.USD)
    ? body.USD
    : null;
}

export interface UsePricesResult {
  /** USD per 1 BTC, or null until the first fetch resolves / on failure. */
  btcUsd: number | null;
  /** True while the first price fetch is in flight (no cached value yet). */
  loading: boolean;
}

/**
 * Live BTC→USD price from mempool.space, used to render USD values beside sats
 * amounts. Always queries mainnet pricing — a sat is a sat, so signet/testnet
 * show the same fiat estimate. Cached for 60s and de-duped across components.
 */
export function usePrices(): UsePricesResult {
  const { fetch } = useHorizonMarket();

  const cached = cache && Date.now() - cache.at < TTL_MS ? cache.value : null;
  const [btcUsd, setBtcUsd] = useState<number | null>(cached);
  const [loading, setLoading] = useState<boolean>(cached === null);

  useEffect(() => {
    let alive = true;

    if (cache && Date.now() - cache.at < TTL_MS) {
      setBtcUsd(cache.value);
      setLoading(false);
      return;
    }

    setLoading(true);
    const request =
      inflight ??
      (inflight = fetchBtcUsd(fetch).then(
        (v) => {
          if (v !== null) cache = { value: v, at: Date.now() };
          inflight = null;
          return v;
        },
        (err) => {
          inflight = null;
          throw err;
        },
      ));

    request
      .then((v) => {
        if (!alive) return;
        setBtcUsd(v);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setBtcUsd(null);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [fetch]);

  return { btcUsd, loading };
}
