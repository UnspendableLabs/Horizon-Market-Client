import { useState, type ReactNode, type CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import { useHorizonMarket } from "../context.js";
import { cx, mempoolTxUrl } from "./format.js";
import { KontorIcon, NoImageIcon } from "./icons.web.js";
import { pendingSwapTrackingTxid, swapListItemView } from "./swapListHelpers.js";
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
  /** The role-aware status line ("Awaiting confirmation" / "Purchase pending"). */
  pendingStatus?: string;
}

const pendingStatusStyle: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.pending,
  fontWeight: 600,
};

// The mempool "Track" link matches the outlined (secondary) "Delist" button so
// the pending tile's footer lines up with its neighbours.
const trackLinkStyle: CSSProperties = {
  ...ws.secondaryButton,
  marginTop: "auto",
  padding: `${webTokens.spacingSm} ${webTokens.spacingSm}`,
  fontSize: webTokens.fontSizeBase,
  lineHeight: "20px",
  borderRadius: webTokens.radiusLg,
  textAlign: "center",
  textDecoration: "none",
  display: "block",
};

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
function ThumbnailOrPlaceholder({
  thumbnailUrl,
  altText,
  imageStyle,
  placeholderStyle,
  imageClassName,
  placeholderClassName,
  iconSize,
  showLabel,
  placeholderContent,
}: {
  thumbnailUrl: string | null;
  /** Alt text for the artwork — the asset's display name (long name for subassets). */
  altText: string | null;
  imageStyle: CSSProperties;
  placeholderStyle: CSSProperties;
  imageClassName?: string;
  placeholderClassName?: string;
  iconSize: number;
  showLabel: boolean;
  /** Custom artwork for listings with no image (e.g. the Kontor mark for KOR). */
  placeholderContent?: ReactNode;
}) {
  // Track the URL that failed (not a bare boolean) so a corrected/refreshed
  // `thumbnailUrl` automatically re-attempts instead of sticking on the
  // placeholder — same pattern as AssetAvatar.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (thumbnailUrl && failedUrl !== thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt={altText ?? ""}
        className={imageClassName}
        style={imageStyle}
        onError={() => setFailedUrl(thumbnailUrl)}
      />
    );
  }
  return (
    <div className={placeholderClassName} style={placeholderStyle}>
      {placeholderContent ?? (
        <>
          <NoImageIcon size={iconSize} />
          {showLabel && <span style={ws.noImageText}>No image available</span>}
        </>
      )}
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
  const { network, kontorNetwork } = useHorizonMarket();

  // Quantity rides beside the asset name ("0.01 XCP"); the meta line carries
  // only the per-unit price, matching how horizon.market lays these out.
  const { actionLabel, thumbnail, title, priceLabel, pricePerUnit, showPerUnit } =
    swapListItemView(swap, isMySwap);
  const actionStyle = isMySwap ? ws.secondaryButton : ws.primaryButton;
  const itemStyle = { ...ws.swapItemGrid, ...style };

  // An in-progress order the API surfaced (via `pending_address`): a listing
  // still settling on-chain or an in-flight purchase. It isn't purchasable, so
  // the tile shows an "Awaiting confirmation" / "Purchase pending" status and a
  // mempool link instead of a Buy/Delist action.
  const isPending = swap.pendingRole !== null;
  const pendingStatus =
    swap.pendingRole === "buyer" ? "Purchase pending" : "Awaiting confirmation";
  const trackUrl = isPending
    ? mempoolTxUrl(network, kontorNetwork, pendingSwapTrackingTxid(swap))
    : null;

  // KOR token listings carry no artwork of their own — show the Kontor brand
  // mark instead of the generic "no image" placeholder.
  const isKontorToken =
    swap.listingType === "kontor" && swap.kontorAssetKind !== "nft";

  return (
    <div className={cx(classNames?.root, className)} style={itemStyle}>
      <ThumbnailOrPlaceholder
        thumbnailUrl={thumbnail}
        altText={swap.assetLongname ?? swap.assetName}
        imageStyle={ws.swapItemImageFull}
        placeholderStyle={ws.swapItemPlaceholder}
        imageClassName={classNames?.image}
        placeholderClassName={classNames?.placeholder}
        iconSize={44}
        showLabel
        placeholderContent={isKontorToken ? <KontorIcon size={56} /> : undefined}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className={classNames?.name} style={nameStyle}>
          {title}
        </span>
        <span className={classNames?.price} style={priceStyle}>
          {priceLabel}
        </span>
        {isPending ? (
          <span className={classNames?.pendingStatus} style={pendingStatusStyle}>
            {pendingStatus}
          </span>
        ) : (
          showPerUnit && (
            <span className={classNames?.meta} style={ws.mutedText}>
              {pricePerUnit} sats/unit
            </span>
          )
        )}
      </div>
      {isPending ? (
        trackUrl ? (
          <a
            className={classNames?.button}
            href={trackUrl}
            target="_blank"
            rel="noreferrer"
            style={trackLinkStyle}
          >
            Track ↗
          </a>
        ) : (
          <span style={{ ...pendingStatusStyle, marginTop: "auto" }}>
            Confirming…
          </span>
        )
      ) : (
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
      )}
    </div>
  );
}
