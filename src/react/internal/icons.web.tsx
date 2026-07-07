import { useState, type CSSProperties } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { assetMonogram, isXcpAsset } from "./assetMonogram.js";
import { webTokens } from "../theme.js";

/**
 * Placeholder glyph for missing artwork (swap tiles / wallet monograms). Shared
 * so the web renderers don't each carry their own copy (native counterpart:
 * `NoImageIcon` in icons.native).
 */
export function NoImageIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/**
 * Orange Bitcoin mark shown beside "Sats" amounts (mirrors Horizon Market's
 * `BtcGold` icon).
 */
export function BtcGoldIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M33.4913 21.1139C31.2206 30.2221 21.9954 35.7652 12.8861 33.4939C3.78056 31.2232 -1.76254 21.9974 0.509183 12.8899C2.77891 3.78065 12.0041 -1.76287 21.1106 0.507855C30.2193 2.77858 35.7621 12.0054 33.4911 21.114L33.4913 21.1139H33.4913Z"
        fill="#F7931A"
      />
      <path
        d="M24.4971 14.5787C24.8355 12.3161 23.1129 11.0999 20.7574 10.2885L21.5215 7.22364L19.6559 6.75876L18.912 9.74293C18.4215 9.6206 17.9178 9.50534 17.4172 9.39107L18.1665 6.3872L16.3019 5.92232L15.5374 8.98619C15.1315 8.89378 14.7329 8.80245 14.3461 8.70621L14.3483 8.69657L11.7754 8.0541L11.2792 10.0468C11.2792 10.0468 12.6633 10.3641 12.6342 10.3836C13.3897 10.5721 13.5263 11.0723 13.5036 11.4687L12.6332 14.9603C12.6852 14.9735 12.7527 14.9926 12.8271 15.0225C12.7649 15.0071 12.6986 14.9902 12.6299 14.9737L11.4099 19.865C11.3175 20.0945 11.0832 20.439 10.555 20.3082C10.5737 20.3353 9.19898 19.9698 9.19898 19.9698L8.27271 22.1054L10.7006 22.7106C11.1523 22.8239 11.5949 22.9424 12.0307 23.0538L11.2587 26.1539L13.1222 26.6187L13.8868 23.5516C14.3959 23.6898 14.8899 23.8173 15.3736 23.9375L14.6116 26.9901L16.4774 27.455L17.2493 24.3608C20.4307 24.9629 22.8229 24.7202 23.8297 21.8426C24.6411 19.5258 23.7894 18.1895 22.1156 17.3181C23.3347 17.037 24.2529 16.2352 24.4977 14.5789L24.4972 14.5785L24.4971 14.5787ZM20.2344 20.556C19.6578 22.8728 15.7571 21.6204 14.4924 21.3063L15.517 17.1993C16.7815 17.5151 20.837 18.1398 20.2345 20.556H20.2344ZM20.8114 14.5451C20.2854 16.6524 17.0388 15.5818 15.9857 15.3193L16.9145 11.5945C17.9677 11.857 21.3593 12.347 20.8116 14.5451H20.8114Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * Kontor brand mark (mirrors Horizon Market's `/kontor-mark.svg`). Shown as the
 * artwork for KOR token listings, which carry no image of their own.
 */
export function KontorIcon({
  size,
  color = "#e8e8e8",
}: {
  size: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M28.0059 29.6918L22.1093 33.0802L12.7583 16.9667L22.085 0.894165L27.9841 4.28255L24.7991 9.76845L20.6212 16.9667L28.0059 29.6918ZM9.26741 10.9531H13.1904L15.1616 7.55743L11.309 0.920731L8.3692 2.60889L5.40998 4.3067L9.26741 10.9531ZM25.6633 13.5807L23.6872 16.9836L25.6439 20.355H33.417V13.5807H25.6633ZM11.2192 19.6184L5.3857 29.6677L11.2847 33.0536L15.1519 26.3928L11.2192 19.6184ZM11.6659 13.5807H0.020752V20.355H7.73317L11.6659 13.5807Z"
        fill={color}
      />
      <path
        d="M28.0062 29.6918L22.1096 33.0802L12.7586 16.9667L22.0853 0.894165L27.9843 4.28255L20.6215 16.9667L28.0062 29.6918Z"
        fill={color}
      />
    </svg>
  );
}

/** Counterparty (XCP) brand mark. */
function XcpIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="16" cy="16" r="16" fill="#EC1550" />
      <path
        d="M30 17.0643L25.9247 21.2926H22.0528C21.8426 21.293 21.6412 21.3798 21.4925 21.5339C21.3439 21.688 21.2602 21.8969 21.2598 22.1148V24.5245C21.2577 24.6514 21.2075 24.7724 21.1202 24.8613C21.0328 24.9503 20.9152 25.0001 20.7928 25H17.8365C17.7752 25 17.7144 24.9875 17.6577 24.9632C17.6011 24.9389 17.5496 24.9032 17.5062 24.8582C17.4628 24.8133 17.4284 24.7599 17.405 24.7011C17.3815 24.6423 17.3694 24.5793 17.3695 24.5157V18.662L19.7895 16.1529C19.8777 16.0668 19.9946 16.0196 20.1157 16.0212C20.2368 16.0228 20.3526 16.0731 20.4386 16.1616L21.5068 17.2691H24.3068L26.1128 15.3979V12.9415L24.2625 11.0146H21.7733L11.8776 21.275H6.1104L2 17.0161V11.2692L6.11474 7.0029H11.7392L14.1776 9.53103C14.2611 9.62136 14.3078 9.74165 14.3078 9.86679C14.3078 9.99193 14.2611 10.1122 14.1776 10.2025L12.1048 12.3445C12.0254 12.4395 11.9129 12.4979 11.792 12.507C11.6711 12.516 11.5517 12.475 11.4599 12.3929C11.4486 12.3826 11.4374 12.371 11.4261 12.3607L10.1336 11.0252H7.72054L5.87912 12.9342V15.354L7.7148 17.2604H10.2704L20.1677 7H25.87L30 11.2823V17.0643Z"
        fill="white"
        transform="translate(4, 4) scale(0.75)"
      />
    </svg>
  );
}

/** XCP brand mark, or a colored monogram — the fallback when no artwork loads. */
function AssetPlaceholder({
  asset,
  size,
  tile,
}: {
  asset: AssetOption;
  size: number;
  tile: CSSProperties;
}) {
  if (isXcpAsset(asset)) {
    return (
      <div style={tile}>
        <XcpIcon size={size} />
      </div>
    );
  }
  const { label, bg } = assetMonogram(asset);
  return (
    <div style={{ ...tile, background: bg }}>
      <span
        style={{
          color: "#fff",
          fontWeight: 700,
          fontSize: Math.max(11, Math.round(size / 4.5)),
          letterSpacing: 0.3,
          fontFamily: webTokens.fontFamily,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Asset thumbnail. Loads the asset's real artwork from the Horizon Market
 * asset-image endpoint (`imageUrl`) and falls back to a brand mark / colored
 * monogram when it's missing or fails to load. `radius` overrides the corner
 * rounding (default: a rounded square; pass `size / 2` for a circle). The image
 * loads lazily and decodes off the main thread so long asset lists render — and
 * scroll — without blocking on artwork fetches.
 */
export function AssetAvatar({
  asset,
  size = 56,
  radius,
  imageUrl,
}: {
  asset: AssetOption;
  size?: number;
  radius?: number;
  imageUrl?: string | null;
}) {
  // Track the URL that failed (not a bare boolean) so switching assets — and thus
  // `imageUrl` — automatically clears the fallback and re-attempts the new image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const tile: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: radius ?? Math.round(size / 4),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  // The native KOR token renders its brand mark — it has no server artwork of
  // its own, so a fetched image would be wrong.
  if (asset.type === "kor") {
    return (
      <div style={tile}>
        <KontorIcon size={size} />
      </div>
    );
  }

  if (!imageUrl || failedUrl === imageUrl) {
    return <AssetPlaceholder asset={asset} size={size} tile={tile} />;
  }

  return (
    <div style={tile}>
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(imageUrl)}
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}
