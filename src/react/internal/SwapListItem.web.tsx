import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import type { SwapListView } from "../hooks/useSwapList.js";
import { cx } from "./format.js";
import {
  swapThumbnailUrl,
  swapDisplayName,
  swapDisplayQuantity,
} from "./swapListHelpers.js";
import * as ws from "./styles.web.js";
import { webTokens } from "../theme.js";

const LISTING_INITIAL: Record<string, string> = {
  counterparty: "C",
  ordinal: "O",
  zeld: "Z",
};

export interface SwapListItemClassNames {
  root?: string;
  image?: string;
  placeholder?: string;
  name?: string;
  price?: string;
  badge?: string;
  meta?: string;
  button?: string;
}

export interface SwapListItemProps {
  swap: AtomicSwap;
  view: SwapListView;
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

const badgeStyle: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  background: webTokens.surface,
  padding: `2px ${webTokens.spacingXs}`,
  borderRadius: webTokens.radiusSm,
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  gap: webTokens.spacingSm,
  alignItems: "center",
  flexWrap: "wrap",
};

function ThumbnailOrPlaceholder({
  thumbnailUrl,
  assetName,
  listingType,
  imageStyle,
  placeholderStyle,
  imageClassName,
  placeholderClassName,
}: {
  thumbnailUrl: string | null;
  assetName: string | null;
  listingType: string;
  imageStyle: CSSProperties;
  placeholderStyle: CSSProperties;
  imageClassName?: string;
  placeholderClassName?: string;
}) {
  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt={assetName ?? ""}
        className={imageClassName}
        style={imageStyle}
      />
    );
  }
  return (
    <div className={placeholderClassName} style={placeholderStyle}>
      {LISTING_INITIAL[listingType] ?? "?"}
    </div>
  );
}

const infoColStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

export function SwapListItem({
  swap,
  view,
  isMySwap,
  onAction,
  className,
  classNames,
  style,
}: SwapListItemProps) {
  const actionLabel = isMySwap ? "Delist" : "Buy";
  const actionStyle = isMySwap ? ws.secondaryButton : ws.primaryButton;
  const itemStyle =
    view === "grid"
      ? { ...ws.swapItemGrid, ...style }
      : { ...ws.swapItemList, ...style };

  const thumbnail = swapThumbnailUrl(swap);
  const displayName = swapDisplayName(swap);
  const displayQuantity = swapDisplayQuantity(swap);
  const showMeta =
    swap.listingType !== "ordinal" &&
    (displayQuantity !== null || swap.pricePerUnit !== null);

  if (view === "grid") {
    return (
      <div className={cx(classNames?.root, className)} style={itemStyle}>
        <ThumbnailOrPlaceholder
          thumbnailUrl={thumbnail}
          assetName={swap.assetName}
          listingType={swap.listingType}
          imageStyle={ws.swapItemImageFull}
          placeholderStyle={ws.swapItemPlaceholder}
          imageClassName={classNames?.image}
          placeholderClassName={classNames?.placeholder}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className={classNames?.name} style={nameStyle}>
            {displayName}
          </span>
          <span className={classNames?.price} style={priceStyle}>
            {swap.price.toLocaleString()} sats
          </span>
          {showMeta && (
            <span className={classNames?.meta} style={ws.mutedText}>
              {displayQuantity !== null && swap.pricePerUnit !== null
                ? `${displayQuantity} × ${swap.pricePerUnit.toLocaleString()} sats/unit`
                : displayQuantity !== null
                  ? `Qty: ${displayQuantity}`
                  : `${swap.pricePerUnit!.toLocaleString()} sats/unit`}
            </span>
          )}
        </div>
        <button
          type="button"
          className={classNames?.button}
          onClick={onAction}
          style={{
            ...actionStyle,
            padding: `${webTokens.spacingXs} ${webTokens.spacingSm}`,
            fontSize: webTokens.fontSizeSm,
          }}
        >
          {actionLabel}
        </button>
      </div>
    );
  }

  return (
    <div className={cx(classNames?.root, className)} style={itemStyle}>
      <ThumbnailOrPlaceholder
        thumbnailUrl={thumbnail}
        assetName={swap.assetName}
        listingType={swap.listingType}
        imageStyle={ws.swapItemImageSmall}
        placeholderStyle={ws.swapItemPlaceholderSmall}
        imageClassName={classNames?.image}
        placeholderClassName={classNames?.placeholder}
      />
      <div style={infoColStyle}>
        <span className={classNames?.name} style={nameStyle}>
          {displayName}
        </span>
        <div style={metaRowStyle}>
          <span className={classNames?.badge} style={badgeStyle}>
            {swap.listingType}
          </span>
          {showMeta && (
            <span className={classNames?.meta} style={ws.mutedText}>
              {displayQuantity !== null && swap.pricePerUnit !== null
                ? `${displayQuantity} × ${swap.pricePerUnit.toLocaleString()} sats/unit`
                : displayQuantity !== null
                  ? `Qty: ${displayQuantity}`
                  : `${swap.pricePerUnit!.toLocaleString()} sats/unit`}
            </span>
          )}
        </div>
      </div>
      <span className={classNames?.price} style={priceStyle}>
        {swap.price.toLocaleString()} sats
      </span>
      <button
        type="button"
        className={classNames?.button}
        onClick={onAction}
        style={actionStyle}
      >
        {actionLabel}
      </button>
    </div>
  );
}
