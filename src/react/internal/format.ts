import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";

export function describeAsset(a: AssetOption): string {
  if (a.type === "zeld") return "ZELD";
  if (a.type === "counterparty") return a.assetName;
  return `Inscription ${a.inscriptionId.slice(0, 8)}…`;
}

export function assetKey(a: AssetOption): string {
  if (a.type === "zeld") return "zeld";
  if (a.type === "counterparty") return `cp:${a.assetName}`;
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

export const CLIENT_NOT_INITIALIZED =
  "Client not initialized — please log in first";

export function cx(
  ...parts: (string | undefined | false | null)[]
): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p));
  return filtered.length ? filtered.join(" ") : undefined;
}
