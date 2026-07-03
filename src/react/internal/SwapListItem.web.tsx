import { useState, type CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import { cx } from "./format.js";
import { swapListItemView } from "./swapListHelpers.js";
import * as ws from "./styles.web.js";
import { webTokens } from "../theme.js";

export interface SwapListItemClassNames {
  root?: string;
  image?: string;
  placeholder?: string;
  name?: string;
  price?: string;
  meta?: string;
  button?: string;
}

export interface SwapListItemProps {
  swap: AtomicSwap;
  isMySwap: boolean;
  onAction: () => void;
  className?: string;
  classNames?: SwapListItemClassNames;
  style?: CSSProperties;
}

const nameStyle: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const priceStyle: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
  fontWeight: 600,
};

/** Mountain + sun "no image" pictogram (matches the common image-placeholder icon). */
function NoImageIcon({ size }: { size: number }) {
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

function ThumbnailOrPlaceholder({
  thumbnailUrl,
  assetName,
  imageStyle,
  placeholderStyle,
  imageClassName,
  placeholderClassName,
  iconSize,
  showLabel,
}: {
  thumbnailUrl: string | null;
  assetName: string | null;
  imageStyle: CSSProperties;
  placeholderStyle: CSSProperties;
  imageClassName?: string;
  placeholderClassName?: string;
  iconSize: number;
  showLabel: boolean;
}) {
  const [errored, setErrored] = useState(false);
  if (thumbnailUrl && !errored) {
    return (
      <img
        src={thumbnailUrl}
        alt={assetName ?? ""}
        className={imageClassName}
        style={imageStyle}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div className={placeholderClassName} style={placeholderStyle}>
      <NoImageIcon size={iconSize} />
      {showLabel && <span style={ws.noImageText}>No image available</span>}
    </div>
  );
}

export function SwapListItem({
  swap,
  isMySwap,
  onAction,
  className,
  classNames,
  style,
}: SwapListItemProps) {
  // Quantity rides beside the asset name ("0.01 XCP"); the meta line carries
  // only the per-unit price, matching how horizon.market lays these out.
  const { actionLabel, thumbnail, title, priceLabel, pricePerUnit, showPerUnit } =
    swapListItemView(swap, isMySwap);
  const actionStyle = isMySwap ? ws.secondaryButton : ws.primaryButton;
  const itemStyle = { ...ws.swapItemGrid, ...style };

  return (
    <div className={cx(classNames?.root, className)} style={itemStyle}>
      <ThumbnailOrPlaceholder
        thumbnailUrl={thumbnail}
        assetName={swap.assetName}
        imageStyle={ws.swapItemImageFull}
        placeholderStyle={ws.swapItemPlaceholder}
        imageClassName={classNames?.image}
        placeholderClassName={classNames?.placeholder}
        iconSize={44}
        showLabel
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className={classNames?.name} style={nameStyle}>
          {title}
        </span>
        <span className={classNames?.price} style={priceStyle}>
          {priceLabel}
        </span>
        {showPerUnit && (
          <span className={classNames?.meta} style={ws.mutedText}>
            {pricePerUnit} sats/unit
          </span>
        )}
      </div>
      <button
        type="button"
        className={classNames?.button}
        onClick={onAction}
        style={{
          ...actionStyle,
          // Pin to the bottom of the equal-height tile so buttons align
          // across the whole grid row.
          marginTop: "auto",
          // Match the header "Sell" button: same font size (14px), height
          // (8px vertical padding + 20px line-height = 36px) and corner
          // radius (lg, the header uses Tailwind's rounded-lg).
          padding: `${webTokens.spacingSm} ${webTokens.spacingSm}`,
          fontSize: webTokens.fontSizeBase,
          lineHeight: "20px",
          borderRadius: webTokens.radiusLg,
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
