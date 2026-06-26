import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";

const SATS_PER_UNIT = 100_000_000n;

/**
 * Convert a human-readable amount (e.g. "1.5") to base units using the asset's
 * `divisible` flag: ×1e8 for divisible (8 decimals), integer otherwise.
 * Throws on malformed input or excess precision.
 */
export function toBaseUnits(human: string, divisible: boolean): bigint {
  const trimmed = human.trim();
  if (!trimmed) throw new Error("Quantity required");
  if (!divisible) {
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Indivisible assets require a whole-number quantity");
    }
    return BigInt(trimmed);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid quantity");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 8) {
    throw new Error("Divisible assets support at most 8 decimal places");
  }
  const fracPadded = frac.padEnd(8, "0");
  return BigInt(whole) * SATS_PER_UNIT + BigInt(fracPadded);
}

/** Format a base-unit bigint back to a human string using `divisible`. */
export function formatAmount(base: bigint, divisible: boolean): string {
  if (!divisible) return base.toString();
  const whole = base / SATS_PER_UNIT;
  const frac = base % SATS_PER_UNIT;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

/** Human-readable balance for a fungible option (normalized string), else "". */
export function assetBalanceLabel(a: AssetOption): string {
  if (a.type === "counterparty" || a.type === "zeld")
    return a.quantityNormalized;
  if (a.type === "kor") return a.amount;
  return "";
}

export function describeAsset(a: AssetOption): string {
  if (a.type === "zeld") return `ZELD — ${a.quantityNormalized}`;
  if (a.type === "counterparty")
    return `${a.assetName} — ${a.quantityNormalized}`;
  if (a.type === "kor") return `KOR — ${a.amount}`;
  if (a.type === "kontor-nft")
    return `NFT ${a.nftId.slice(0, 8)}…${a.nftId.slice(-6)}`;
  return `Inscription ${a.inscriptionId.slice(0, 8)}…`;
}

export function assetKey(a: AssetOption): string {
  if (a.type === "zeld") return `zeld:${a.address}`;
  if (a.type === "counterparty") return `cp:${a.address}:${a.assetName}`;
  if (a.type === "kor") return `kor:${a.address}`;
  if (a.type === "kontor-nft")
    return `nft:${a.address}:${a.contractAddress}:${a.nftId}`;
  return `ord:${a.utxoId}:${a.inscriptionId}`;
}

export function formatAssetLabel(swap: AtomicSwap): string {
  if (swap.listingType === "ordinal")
    return `Inscription ${swap.assetUtxoId ?? swap.id}`;
  const qty = swap.assetQuantity?.toString() ?? "?";
  const name = swap.assetName ?? "?";
  return `${qty} ${name}`;
}

export function truncate(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** "Never" / "just now" / "N min ago" / "N hr ago" / "N day(s) ago". */
export function formatRelativeTime(
  fetchedAt: number | null,
  now: number = Date.now(),
): string {
  if (fetchedAt === null) return "Never";
  const sec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export const CLIENT_NOT_INITIALIZED =
  "Client not initialized — please log in first";

export function cx(
  ...parts: (string | undefined | false | null)[]
): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p));
  return filtered.length ? filtered.join(" ") : undefined;
}
