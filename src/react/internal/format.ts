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

const isXcp = (a: AssetOption): boolean =>
  a.type === "counterparty" && a.assetName === "XCP";

/**
 * Counterparty options with XCP pinned to the top; every other asset keeps its
 * original (server) order. The picker's Counterparty group always leads with XCP.
 */
export function counterpartyXcpFirst(options: AssetOption[]): AssetOption[] {
  return [...options.filter(isXcp), ...options.filter((a) => !isXcp(a))];
}

/**
 * Kontor options (KOR + Kontor NFTs) with the KOR token pinned to the top; NFTs
 * keep their original order. The picker's merged Kontor group always leads with KOR.
 */
export function kontorKorFirst(options: AssetOption[]): AssetOption[] {
  return [
    ...options.filter((a) => a.type === "kor"),
    ...options.filter((a) => a.type !== "kor"),
  ];
}

export function describeAsset(a: AssetOption): string {
  if (a.type === "zeld") return `ZELD — ${a.quantityNormalized}`;
  if (a.type === "counterparty")
    return `${a.assetLongname ?? a.assetName} — ${a.quantityNormalized}`;
  if (a.type === "kor") return `KOR — ${a.amount}`;
  if (a.type === "kontor-nft")
    return `NFT ${a.nftId.slice(0, 8)}…${a.nftId.slice(-6)}`;
  return `Inscription ${a.inscriptionId.slice(0, 8)}…`;
}

/**
 * "You're selling" headline for the review screen: a top line (asset name) and
 * an optional sub line (quantity + unit), adapted per asset type.
 */
export function sellingDisplay(
  a: AssetOption,
  quantity: string,
): { name: string; sub: string | null } {
  switch (a.type) {
    case "counterparty":
      return { name: a.assetLongname ?? a.assetName, sub: `${quantity} units` };
    case "zeld":
      return { name: "ZELD", sub: `${quantity} ZELD` };
    case "kor":
      return { name: "KOR", sub: `${quantity} KOR` };
    case "kontor-nft":
      return { name: `NFT ${truncate(a.nftId)}`, sub: null };
    case "ordinal":
      return { name: "Inscription", sub: truncate(a.inscriptionId) };
  }
}

/**
 * "You'll receive" headline for the buy review screen: a top line (asset name)
 * and an optional sub line (quantity + unit), derived from a listed `AtomicSwap`
 * (which — unlike an owned `AssetOption` — carries its fields flat).
 */
export function buyingDisplay(
  swap: AtomicSwap,
): { name: string; sub: string | null } {
  if (swap.listingType === "ordinal") {
    return {
      name: "Inscription",
      sub:
        swap.inscriptionNumber != null
          ? `#${swap.inscriptionNumber}`
          : truncate(swap.assetUtxoId ?? swap.id),
    };
  }
  if (swap.listingType === "kontor") {
    if (swap.kontorAssetKind === "nft") {
      return {
        name: swap.kontorNftId ? `NFT ${truncate(swap.kontorNftId)}` : "NFT",
        sub: null,
      };
    }
    return {
      name: "KOR",
      sub: swap.kontorAmount ? `${swap.kontorAmount} KOR` : null,
    };
  }
  // counterparty / zeld — both carry assetName + assetQuantity. Counterparty
  // subassets prefer their resolved long name (zeld has none, so it falls back).
  const name = swap.assetLongname ?? swap.assetName ?? "Asset";
  const qty = swap.assetQuantity != null ? swap.assetQuantity.toString() : null;
  const unit = swap.listingType === "zeld" ? name : "units";
  return { name, sub: qty ? `${qty} ${unit}` : null };
}

/**
 * Map an owned asset to the `(asset, listing_type)` identifiers expected by the
 * Horizon Market asset-image endpoint. Brand-only fungibles (XCP/ZELD/KOR) pass
 * their well-known name so the endpoint returns the brand logo.
 */
function assetImageIdentity(a: AssetOption): {
  asset: string;
  listingType: "counterparty" | "ordinal" | "zeld" | "kontor";
} {
  switch (a.type) {
    case "counterparty":
      return { asset: a.assetName, listingType: "counterparty" };
    case "zeld":
      return { asset: "ZELD", listingType: "zeld" };
    case "kor":
      return { asset: "KOR", listingType: "kontor" };
    case "kontor-nft":
      return { asset: a.nftId, listingType: "kontor" };
    case "ordinal":
      return { asset: a.inscriptionId, listingType: "ordinal" };
  }
}

/**
 * URL of the Horizon Market asset-image endpoint for an owned asset, usable
 * directly as an `<img src>` / `Image` source: it 302-redirects to the real
 * artwork (and 404s when the asset has no renderable image, so callers should
 * fall back to a placeholder on error). `variant` picks the full image or the
 * thumbnail. The network follows the request host, so `baseUrl` must already
 * point at the deployment for the active network.
 */
export function assetImageUrl(
  baseUrl: string,
  a: AssetOption,
  variant: "image" | "thumbnail" = "thumbnail",
): string {
  const { asset, listingType } = assetImageIdentity(a);
  const params = new URLSearchParams({
    asset,
    listing_type: listingType,
    redirect: variant,
  });
  return `${baseUrl.replace(/\/$/, "")}/api/atomic-swaps/asset-image?${params.toString()}`;
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
  const name = swap.assetLongname ?? swap.assetName ?? "?";
  return `${qty} ${name}`;
}

export function truncate(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * mempool.space transaction explorer URL for the active network, or null when
 * `txid` is missing. Signet shares the SDK's `testnet` params, so it's
 * distinguished by `kontorNetwork === "signet"`.
 */
export function mempoolTxUrl(
  network: "mainnet" | "testnet",
  kontorNetwork: "signet" | undefined,
  txid: string | null | undefined,
): string | null {
  if (!txid) return null;
  const base =
    network === "mainnet"
      ? "https://mempool.space"
      : kontorNetwork === "signet"
        ? "https://mempool.space/signet"
        : "https://mempool.space/testnet";
  return `${base}/tx/${txid}`;
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

/** USD value of a sats amount, or null when no BTC/USD price is available. */
export function satsToUsd(
  sats: number,
  btcUsd: number | null | undefined,
): number | null {
  if (btcUsd == null || !Number.isFinite(btcUsd)) return null;
  if (!Number.isFinite(sats)) return null;
  return (sats / 1e8) * btcUsd;
}

/**
 * Format a sats amount as a USD currency string ("$0.31"), or null without a
 * price. Sub-cent listings keep more precision so the line never reads a
 * misleading "$0.00" for a non-zero value.
 */
export function formatUsd(
  sats: number,
  btcUsd: number | null | undefined,
): string | null {
  const usd = satsToUsd(sats, btcUsd);
  if (usd === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd > 0 && usd < 0.01 ? 6 : 2,
  }).format(usd);
}

/** Group-separated sats amount ("3,450"). */
export function formatSats(sats: number): string {
  return Math.round(sats).toLocaleString("en-US");
}

/**
 * mempool.space REST API base for the active network (no trailing slash).
 * Signet shares the SDK's `testnet` params, so it's distinguished by
 * `kontorNetwork === "signet"` (mirrors {@link mempoolTxUrl}).
 */
export function mempoolApiBase(
  network: "mainnet" | "testnet",
  kontorNetwork: "signet" | undefined,
): string {
  if (network === "mainnet") return "https://mempool.space/api";
  return kontorNetwork === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/testnet/api";
}

export const CLIENT_NOT_INITIALIZED =
  "Client not initialized — please log in first";

/**
 * Flatten an error and its `cause` chain into one human-readable line.
 *
 * Wrapped workflow errors (e.g. `KontorPurchaseNotRecordedError`) carry the real
 * underlying reason on `.cause` — a `HorizonMarketApiError` like "HTTP 400: A
 * purchase is already pending for this listing". The result screen used to show
 * only the wrapper's own message, hiding *why* the step failed; joining the
 * chain surfaces both the guidance and the root cause.
 */
export function errorDisplayMessage(err: unknown): string {
  if (!(err instanceof Error)) return err ? String(err) : "Unknown error";
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    if (cur.message && !parts.includes(cur.message)) parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.length ? parts.join(" — ") : "Unknown error";
}

export function cx(
  ...parts: (string | undefined | false | null)[]
): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p));
  return filtered.length ? filtered.join(" ") : undefined;
}
