/**
 * Spendable on-chain BTC balance via mempool.space — the CLI port of the SDK's
 * `useBtcBalance`. Confirmed balance is in `chain_stats`, unconfirmed deltas in
 * `mempool_stats`; spendable = (funded − spent) summed across both and across
 * every address.
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

async function fetchOne(
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

/** Sum the spendable BTC balance (sats) across `addresses` for a mempool `base`. */
export async function fetchBtcBalanceSats(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  addresses: string[],
): Promise<bigint> {
  const totals = await Promise.all(
    [...new Set(addresses.filter(Boolean))].map((a) => fetchOne(fetchImpl, base, a)),
  );
  return totals.reduce((a, b) => a + b, 0n);
}
