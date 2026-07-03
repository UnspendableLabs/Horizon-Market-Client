import type { AssetOption } from "../hooks/useAssets.js";

/**
 * Deterministic palette for an asset's placeholder monogram (the colored badge
 * shown behind an {@link AssetAvatar} until real artwork loads). Shared by the
 * web and native `AssetAvatar` so both render an asset with the same hue.
 */
export const MONOGRAM_PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#0ea5e9",
  "#84cc16",
];

/** Stable palette color hashed from a seed string (asset name / inscription id). */
export function hashHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return MONOGRAM_PALETTE[Math.abs(h) % MONOGRAM_PALETTE.length];
}

/**
 * Short label + background color for an asset's placeholder monogram. XCP is not
 * special-cased here — the Counterparty `XCP` asset renders a brand mark instead
 * of a monogram, so both platforms handle it before calling this.
 */
export function assetMonogram(asset: AssetOption): { label: string; bg: string } {
  switch (asset.type) {
    case "counterparty":
      return { label: asset.assetName.slice(0, 4), bg: hashHue(asset.assetName) };
    case "zeld":
      return { label: "ZELD", bg: "#2563eb" };
    case "kor":
      return { label: "KOR", bg: "#f59e0b" };
    case "kontor-nft":
      return { label: "NFT", bg: "#a855f7" };
    case "ordinal":
      return { label: "ORD", bg: hashHue(asset.inscriptionId) };
  }
}

/** True when the asset is the Counterparty XCP token (which uses a brand mark). */
export function isXcpAsset(asset: AssetOption): boolean {
  return asset.type === "counterparty" && asset.assetName === "XCP";
}
