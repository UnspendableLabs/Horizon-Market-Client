/**
 * Direct reads of a wallet's ZELD balance from the public ZeldHash API.
 *
 * ZELD is its OWN protocol — NOT a Counterparty asset. The balance is the sum of
 * per-UTXO `balance` values (base units, 8 decimals) from
 * `GET ${baseUrl}/addresses/{address}/utxos`. Mainnet only.
 */

/** ZELD uses 8 decimal places like Bitcoin. */
export const ZELD_DECIMALS = 8;
export const ZELD_SATOSHI_DIVISOR = 100_000_000n;

/** ZeldHash 400 message pattern when an address has too many confirmed UTXOs. */
const TOO_MANY_UTXOS_PATTERN = /More than 500 confirmed UTXOs/i;

/**
 * Thrown when an address has more than 500 ZELD UTXOs. The ZeldHash API caps at
 * 500 confirmed UTXOs per address; surface this as a friendly, non-fatal message
 * (the caller should fail only the ZELD group, not the whole balances list).
 */
export class ZeldTooManyUtxosError extends Error {
  constructor() {
    super(
      "This address has more than 500 ZELD UTXOs. To view your ZELD balance, " +
        "please consolidate your UTXOs by sending ZELD to yourself.",
    );
    this.name = "ZeldTooManyUtxosError";
  }
}

/** A summed ZELD balance for a single address (base units, 8 decimals). */
export interface ZeldBalance {
  asset: "ZELD";
  address: string;
  /** Total ZELD in base units (sum of per-UTXO `balance`). */
  balance: bigint;
  /** Human-readable total (balance / 1e8, fixed to 8 decimals). */
  quantityNormalized: string;
  /** ZELD is always divisible. */
  divisible: true;
}

interface ZeldUtxoWire {
  balance?: unknown;
  txid?: unknown;
  vout?: unknown;
}

function toBalance(value: unknown): bigint {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return BigInt(value.trim());
  return 0n;
}

function normalize(total: bigint): string {
  const whole = total / ZELD_SATOSHI_DIVISOR;
  const frac = total % ZELD_SATOSHI_DIVISOR;
  const fracStr = frac.toString().padStart(ZELD_DECIMALS, "0");
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Fetch and sum the ZELD balance for a single `address`. Returns `null` when the
 * total is 0 (no ZELD). Throws {@link ZeldTooManyUtxosError} on the 400
 * "More than 500 confirmed UTXOs" response.
 */
export async function getZeldBalance(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
  address: string,
): Promise<ZeldBalance | null> {
  const root = baseUrl.replace(/\/$/, "");
  const url = `${root}/addresses/${encodeURIComponent(address)}/utxos`;

  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    let message = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      message = typeof body?.error === "string" ? body.error : "";
    } catch {
      message = res.statusText;
    }
    if (res.status === 400 && TOO_MANY_UTXOS_PATTERN.test(message)) {
      throw new ZeldTooManyUtxosError();
    }
    throw new Error(
      `ZeldHash API returned ${res.status}: ${message || res.statusText}`,
    );
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return null;

  let total = 0n;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    total += toBalance((item as ZeldUtxoWire).balance);
  }

  if (total <= 0n) return null;

  return {
    asset: "ZELD",
    address,
    balance: total,
    quantityNormalized: normalize(total),
    divisible: true,
  };
}
