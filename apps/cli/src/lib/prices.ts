/**
 * Live BTC→USD price from mempool.space — the CLI port of the SDK's `usePrices`.
 * Always queries mainnet pricing (a sat is a sat), used to annotate sats amounts.
 */
const PRICES_URL = "https://mempool.space/api/v1/prices";

/** Returns USD per 1 BTC, or null on failure (USD annotations are then omitted). */
export async function fetchBtcUsd(
  fetchImpl: typeof globalThis.fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(PRICES_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { USD?: unknown };
    return typeof body.USD === "number" && Number.isFinite(body.USD) ? body.USD : null;
  } catch {
    return null;
  }
}
