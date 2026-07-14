import { useEffect, useState, type CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import { mempoolTxUrl } from "./format.js";
import {
  pendingSwapTrackingTxid,
  swapListItemView,
  swapMonogram,
} from "./swapListHelpers.js";
import { useHorizonMarket } from "../context.js";
import { webTokens } from "../theme.js";

export interface PendingSwapItemClassNames {
  root?: string;
  thumbnail?: string;
  title?: string;
  price?: string;
  status?: string;
  trackLink?: string;
}

const THUMB = 48;

// Shared with WorkflowProgress' spinner — the keyframe name is intentionally the
// same so both inject a compatible `@keyframes hm-spin` (identical rules, so a
// duplicate is harmless if both mount).
const SPIN_KEYFRAMES = "@keyframes hm-spin { to { transform: rotate(360deg); } }";
const KEYFRAMES_STYLE_ID = "hm-pending-swap-keyframes";

function useSpinKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
    if (document.getElementById("hm-workflow-progress-keyframes")) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_STYLE_ID;
    el.textContent = SPIN_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

const rootStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  padding: webTokens.spacingSm,
  background: webTokens.surface,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

const thumbBase: CSSProperties = {
  width: THUMB,
  height: THUMB,
  flexShrink: 0,
  borderRadius: webTokens.radiusSm,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const titleStyle: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const priceStyle: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
};

const statusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingXs,
  marginTop: 2,
  flexWrap: "wrap",
};

const statusStyle: CSSProperties = {
  color: webTokens.pending,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
};

const trackLinkStyle: CSSProperties = {
  color: webTokens.primary,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  textDecoration: "none",
};

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        border: `2px solid ${webTokens.pending}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "hm-spin 0.8s linear infinite",
      }}
    />
  );
}

/**
 * A single "awaiting confirmation" row shown above the buy grid for the
 * connected wallet's own not-yet-funded listing: small thumbnail, the asset and
 * price, a spinner + "Awaiting confirmation" status, and (when a funding txid is
 * known) a mempool.space tracking link. Informational only — the listing can't
 * be bought until it's funded.
 */
export function PendingSwapItem({
  swap,
  className,
  classNames,
  style,
}: {
  swap: AtomicSwap;
  className?: string;
  classNames?: PendingSwapItemClassNames;
  style?: CSSProperties;
}) {
  useSpinKeyframes();
  const { network, kontorNetwork } = useHorizonMarket();

  // `isMySwap` only drives the (unused here) action label; pass true so we don't
  // imply a Buy affordance. We just read thumbnail/title/price.
  const { thumbnail, title, priceLabel } = swapListItemView(swap, true);
  const monogram = swapMonogram(swap);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(thumbnail) && failedUrl !== thumbnail;

  const trackUrl = mempoolTxUrl(
    network,
    kontorNetwork,
    pendingSwapTrackingTxid(swap),
  );

  return (
    <div
      className={[classNames?.root, className].filter(Boolean).join(" ") || undefined}
      style={{ ...rootStyle, ...style }}
    >
      <div
        className={classNames?.thumbnail}
        style={{
          ...thumbBase,
          background: showImage ? "transparent" : monogram.bg,
        }}
      >
        {showImage ? (
          <img
            src={thumbnail as string}
            alt={title}
            onError={() => setFailedUrl(thumbnail)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>
            {monogram.label}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span className={classNames?.title} style={titleStyle}>
          {title}
        </span>
        <span className={classNames?.price} style={priceStyle}>
          {priceLabel}
        </span>
        <div style={statusRowStyle}>
          <Spinner />
          <span className={classNames?.status} style={statusStyle}>
            Awaiting confirmation
          </span>
          {trackUrl && (
            <a
              className={classNames?.trackLink}
              href={trackUrl}
              target="_blank"
              rel="noreferrer"
              style={trackLinkStyle}
            >
              Track ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
