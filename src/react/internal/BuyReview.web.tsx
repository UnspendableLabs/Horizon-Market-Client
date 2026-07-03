import { useState, type CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import { webTokens } from "../theme.js";
import { buyingDisplay, formatSats, formatUsd, truncate } from "./format.js";
import { swapMonogram } from "./swapListHelpers.js";
import { BtcGoldIcon } from "./icons.web.js";
import {
  FEE_HINTS,
  FEE_LABELS,
  FEE_OPTIONS,
  type FeeOption,
  type UseBuyReviewResult,
} from "./useBuyReview.js";
import * as ws from "./styles.web.js";

export interface BuyReviewClassNames {
  button?: string;
  buttonSecondary?: string;
}

export interface BuyReviewProps {
  swap: AtomicSwap;
  review: UseBuyReviewResult;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  classNames?: BuyReviewClassNames;
}

const buyingRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
};

const assetNameStyle: CSSProperties = {
  fontSize: webTokens.fontSizeLg,
  fontWeight: 600,
  color: webTokens.text,
};

const buyingSub: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
};

const amountRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
};

const bigNumber: CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  lineHeight: 1.05,
  color: webTokens.text,
};

const satsTag: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontWeight: 600,
  color: webTokens.text,
};

const usdLine: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.textMuted,
};

const breakLabel: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: webTokens.textMuted,
  fontSize: webTokens.fontSizeBase,
};

const divider: CSSProperties = {
  height: 1,
  background: webTokens.border,
  margin: `${webTokens.spacingXs} 0`,
};

const breakRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
};

const breakValue: CSSProperties = {
  textAlign: "right",
  fontWeight: 600,
  color: webTokens.text,
};

const metaRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
  fontSize: webTokens.fontSizeSm,
};

const metaValue: CSSProperties = {
  color: webTokens.text,
  fontFamily: "monospace",
};

const pendingNote: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  lineHeight: 1.5,
};

const infoWrap: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const infoDot: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 15,
  height: 15,
  flexShrink: 0,
  padding: 0,
  borderRadius: "50%",
  border: `1px solid ${webTokens.textMuted}`,
  background: "transparent",
  color: webTokens.textMuted,
  fontSize: 9,
  fontWeight: 700,
  fontStyle: "italic",
  lineHeight: 1,
  cursor: "pointer",
};

const tooltipBubble: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: 0,
  zIndex: 20,
  width: "max-content",
  maxWidth: 240,
  padding: "8px 10px",
  background: webTokens.backgroundElevated,
  color: webTokens.text,
  border: `1px solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 400,
  fontStyle: "normal",
  lineHeight: 1.4,
  textAlign: "left",
  whiteSpace: "normal",
  boxShadow: "0 8px 24px -6px rgba(0, 0, 0, 0.5)",
  pointerEvents: "none",
};

/**
 * Small circled "i" with an explanation shown on hover, keyboard focus, or tap
 * (the native `title` tooltip is unreliable — delayed and easy to miss).
 */
function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={infoWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={infoDot}
      >
        i
      </button>
      {open && (
        <span role="tooltip" style={tooltipBubble}>
          {text}
        </span>
      )}
    </span>
  );
}

function SatsValue({ sats, btcUsd }: { sats: number; btcUsd: number | null }) {
  const usd = formatUsd(sats, btcUsd);
  return (
    <div style={{ textAlign: "right" }}>
      <div style={breakValue}>{formatSats(sats)} SATS</div>
      {usd && <div style={usdLine}>{usd}</div>}
    </div>
  );
}

/**
 * Purchase thumbnail. Uses the listing's own artwork (`thumbnailUrl` / `imageUrl`)
 * with a colored monogram fallback when it's missing or fails to load.
 */
function SwapAvatar({ swap, size = 56 }: { swap: AtomicSwap; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = swap.thumbnailUrl ?? swap.imageUrl;
  const tile: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: Math.round(size / 4),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  if (!url || failed) {
    const { label, bg } = swapMonogram(swap);
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

  return (
    <div style={tile}>
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

export function BuyReview({
  swap,
  review,
  isSubmitting,
  onConfirm,
  onCancel,
  classNames,
}: BuyReviewProps) {
  const {
    feeOption,
    setFeeOption,
    rateFor,
    btcUsd,
    isKontor,
    priceSats,
    royaltySats,
    minerFeeSats,
    totalUsd,
    totalDisplay,
    networkFeeHint,
    minerFeePending,
    previewError,
    canConfirm,
  } = review;

  const buying = buyingDisplay(swap);

  const feeSelect = (
    <select
      value={feeOption}
      onChange={(e) => setFeeOption(e.target.value as FeeOption)}
      style={ws.feeRateSelect}
      aria-label="Fee rate"
    >
      {FEE_OPTIONS.map((opt) => {
        const rate = rateFor(opt);
        return (
          <option key={opt} value={opt}>
            {FEE_LABELS[opt]} · {rate ?? "…"} sat/vB
          </option>
        );
      })}
    </select>
  );

  return (
    <>
      {/* You'll receive */}
      <div style={ws.reviewSection}>
        <span style={ws.reviewSectionLabel}>You&apos;ll receive</span>
        <div style={buyingRow}>
          <SwapAvatar swap={swap} size={56} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={assetNameStyle}>{buying.name}</span>
            {buying.sub && <span style={buyingSub}>{buying.sub}</span>}
          </div>
        </div>
        <div style={divider} />
        <div style={metaRow}>
          <span style={ws.reviewSectionLabel}>Seller</span>
          <span style={metaValue}>{truncate(swap.sellerAddress)}</span>
        </div>
        {swap.expiresAt && (
          <div style={metaRow}>
            <span style={ws.reviewSectionLabel}>Expires</span>
            <span style={metaValue}>
              {new Date(swap.expiresAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* You'll pay */}
      <div style={ws.reviewSection}>
        <div style={headerRow}>
          <span style={ws.reviewSectionLabel}>You&apos;ll pay</span>
          {feeSelect}
        </div>

        <div style={amountRow}>
          <div>
            <div style={bigNumber}>{totalDisplay}</div>
            {totalUsd && <div style={usdLine}>{totalUsd}</div>}
          </div>
          <div style={satsTag}>
            <BtcGoldIcon size={22} />
            <span>Sats</span>
          </div>
        </div>

        <div style={divider} />

        <div style={breakRow}>
          <span style={breakLabel}>
            Price
            <InfoHint text={FEE_HINTS.price} />
          </span>
          <SatsValue sats={priceSats} btcUsd={btcUsd} />
        </div>

        {royaltySats != null && royaltySats > 0 && (
          <div style={breakRow}>
            <span style={breakLabel}>
              Royalty
              <InfoHint text={FEE_HINTS.royalty} />
            </span>
            <SatsValue sats={royaltySats} btcUsd={btcUsd} />
          </div>
        )}

        <div style={breakRow}>
          <span style={breakLabel}>
            Network fee
            <InfoHint text={networkFeeHint} />
          </span>
          {minerFeeSats != null ? (
            <SatsValue sats={minerFeeSats} btcUsd={btcUsd} />
          ) : (
            <span style={breakValue}>{minerFeePending}</span>
          )}
        </div>

        {isKontor && (
          <span style={pendingNote}>
            A Kontor purchase is composed locally at the selected fee rate when
            you confirm, so the exact miner fee is set at that point.
          </span>
        )}

        {previewError && !isKontor && (
          <span style={ws.errorText}>
            Couldn&apos;t estimate the cost: {previewError.message}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={isSubmitting || !canConfirm}
        className={classNames?.button}
        style={ws.withDisabled(ws.primaryButton, isSubmitting || !canConfirm)}
      >
        {isSubmitting ? "Confirming…" : "Confirm Purchase"}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className={classNames?.buttonSecondary}
          style={ws.withDisabled(ws.textButton, isSubmitting)}
        >
          Cancel
        </button>
      )}
    </>
  );
}
