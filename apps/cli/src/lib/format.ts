import pc from "picocolors";

const SATS_PER_BTC = 100_000_000n;

/**
 * Convert a human amount ("1.5") to base units using `divisible`: ×1e8 for
 * divisible (8 decimals), integer otherwise. Mirrors the SDK's `toBaseUnits`.
 */
export function toBaseUnits(human: string, divisible: boolean): bigint {
  const trimmed = human.trim();
  if (!trimmed) throw new Error("Amount required");
  if (!divisible) {
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Indivisible assets require a whole-number amount");
    }
    return BigInt(trimmed);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid amount");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 8) {
    throw new Error("Divisible assets support at most 8 decimal places");
  }
  return BigInt(whole) * SATS_PER_BTC + BigInt(frac.padEnd(8, "0"));
}

/** Format a sats bigint as a BTC decimal string ("0.00010000"). */
export function satsToBtc(sats: bigint): string {
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  const whole = abs / SATS_PER_BTC;
  const frac = (abs % SATS_PER_BTC).toString().padStart(8, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Group-separated sats amount ("3,450"). */
export function formatSats(sats: number): string {
  return Math.round(sats).toLocaleString("en-US");
}

/**
 * Format an asset quantity for display. Divisible assets (Counterparty divisible,
 * ZELD) carry their quantity in base units (×1e8) — scale down and strip trailing
 * zeros ("100000000" → "1", "150000000" → "1.5"). Indivisible assets are a literal
 * unit count. Mirrors the app's `formatQuantity`.
 */
export function formatAssetQuantity(quantity: bigint, divisible: boolean): string {
  if (!divisible) return quantity.toLocaleString("en-US");
  const whole = quantity / SATS_PER_BTC;
  const remainder = quantity % SATS_PER_BTC;
  if (remainder === 0n) return whole.toLocaleString("en-US");
  const dec = remainder.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${dec}`;
}

/** USD currency string for a sats amount, or null without a price. */
export function formatUsd(
  sats: number,
  btcUsd: number | null | undefined,
): string | null {
  if (btcUsd == null || !Number.isFinite(btcUsd) || !Number.isFinite(sats)) {
    return null;
  }
  const usd = (sats / 1e8) * btcUsd;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd > 0 && usd < 0.01 ? 6 : 2,
  }).format(usd);
}

/** Middle-truncate a long id / address. */
export function truncate(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** "just now" / "N min ago" / "N hr ago" / "N day(s) ago" from an ISO string. */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** Key/value line for human output ("  Label   value"). */
export function kv(label: string, value: string, width = 16): string {
  return `  ${pc.dim(label.padEnd(width))}${value}`;
}
