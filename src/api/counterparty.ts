/**
 * Direct reads of a wallet's owned balances from the public Counterparty API v2.
 *
 * The Horizon backend `/api/wallets/{addr}/balances` route is auth-gated, so the
 * unauthenticated web example app reads the public Counterparty API directly via
 * the injected `fetch` (mirroring the direct ord-API pattern in `useAssets`).
 *
 * ZELD is NOT a Counterparty asset — it has its own protocol/endpoint (see
 * `./zeld.ts`) — so any `ZELD` row from this endpoint is skipped here.
 */

/** A single owned Counterparty (or XCP) balance, tagged with the holding address. */
export interface CounterpartyBalance {
  /** Asset name (e.g. "XCP", "RAREPEPE"). */
  asset: string;
  /** The address that holds this balance. */
  address: string;
  /** Quantity in base units (sats for divisible assets, whole units otherwise). */
  quantity: bigint;
  /** Human-readable quantity as returned by the API (e.g. "12.5"). */
  quantityNormalized: string;
  /** Whether the asset is divisible (8 decimals) or indivisible. */
  divisible: boolean;
}

/** ZELD is handled by its own module — never surface it as a Counterparty asset. */
const ZELD_ASSET = "ZELD";

interface BalanceRowWire {
  asset?: unknown;
  quantity?: unknown;
  quantity_normalized?: unknown;
  asset_info?: { divisible?: unknown } | null;
}

interface BalancesPageWire {
  result?: unknown;
  next_cursor?: unknown;
  error?: { message?: string };
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value))
    return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim()))
    return BigInt(value.trim());
  return null;
}

function mapRow(raw: unknown, address: string): CounterpartyBalance | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as BalanceRowWire;
  if (typeof row.asset !== "string" || row.asset.length === 0) return null;
  if (row.asset === ZELD_ASSET) return null;
  const quantity = toBigInt(row.quantity);
  if (quantity === null || quantity <= 0n) return null;
  const divisible = row.asset_info?.divisible === true;
  const quantityNormalized =
    typeof row.quantity_normalized === "string"
      ? row.quantity_normalized
      : quantity.toString();
  return {
    asset: row.asset,
    address,
    quantity,
    quantityNormalized,
    divisible,
  };
}

/**
 * Fetch the owned XCP + Counterparty asset balances for a single `address`,
 * following `next_cursor` pagination. Returns base-unit quantities tagged with
 * the holding address. `ZELD` rows are skipped (handled by its own protocol).
 */
export async function getCounterpartyBalances(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
  address: string,
): Promise<CounterpartyBalance[]> {
  const root = baseUrl.replace(/\/$/, "");
  const out: CounterpartyBalance[] = [];
  let cursor: string | null = null;

  do {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const url =
      `${root}/v2/addresses/${encodeURIComponent(address)}/balances` +
      `?type=address&verbose=true&limit=100${cursorParam}`;

    const res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `Counterparty API returned ${res.status}: ${res.statusText}`,
      );
    }
    const page = (await res.json()) as BalancesPageWire;
    if (page.error) {
      throw new Error(
        `Counterparty API error: ${page.error.message ?? "unknown error"}`,
      );
    }

    if (Array.isArray(page.result)) {
      for (const raw of page.result) {
        const mapped = mapRow(raw, address);
        if (mapped) out.push(mapped);
      }
    }

    cursor =
      typeof page.next_cursor === "string" && page.next_cursor.length > 0
        ? page.next_cursor
        : null;
  } while (cursor);

  return out;
}
