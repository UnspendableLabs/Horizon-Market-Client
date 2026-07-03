import { useState, type CSSProperties } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { webTokens } from "../theme.js";
import { assetImageUrl, formatSats, formatUsd, sellingDisplay } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.web.js";
import {
  FEE_HINTS,
  FEE_LABELS,
  FEE_OPTIONS,
  type FeeOption,
  type UseSellReviewResult,
} from "./useSellReview.js";
import * as ws from "./styles.web.js";

export interface SellReviewClassNames {
  button?: string;
  buttonSecondary?: string;
  summary?: string;
}

export interface SellReviewProps {
  asset: AssetOption;
  quantity: string;
  priceSats: number;
  review: UseSellReviewResult;
  isSubmitting: boolean;
  onSign: () => void;
  onCancel: () => void;
  classNames?: SellReviewClassNames;
}

const sellingRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
};

const assetNameStyle: CSSProperties = {
  fontSize: webTokens.fontSizeLg,
  fontWeight: 600,
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

/** "You're selling" quantity/units line — white so the amount reads clearly. */
const sellingSub: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
};

/** A fee-breakdown label paired with its inline info hint. */
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

function SatsValue({
  sats,
  btcUsd,
}: {
  sats: number;
  btcUsd: number | null;
}) {
  const usd = formatUsd(sats, btcUsd);
  return (
    <div style={{ textAlign: "right" }}>
      <div style={breakValue}>{formatSats(sats)} SATS</div>
      {usd && <div style={usdLine}>{usd}</div>}
    </div>
  );
}

export function SellReview({
  asset,
  quantity,
  priceSats,
  review,
  isSubmitting,
  onSign,
  onCancel,
  classNames,
}: SellReviewProps) {
  const {
    estimates,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor,
    btcUsd,
    isKontor,
    cost,
    feeWaived,
    paidWithCredit,
    previewLoading,
    previewError,
    canSign,
    kontorListingSats,
    kontorListingLoading,
    kontorListingError,
    kontorMinerFeeSats,
    kontorTotalSats,
  } = review;

  const { baseUrl } = useHorizonMarket();
  const imageUrl = assetImageUrl(baseUrl, asset);
  const selling = sellingDisplay(asset, quantity);
  const priceUsd = formatUsd(priceSats, btcUsd);
  const totalUsd = cost ? formatUsd(cost.total, btcUsd) : null;

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
      {/* You're selling */}
      <div style={ws.reviewSection}>
        <span style={ws.reviewSectionLabel}>You&apos;re selling</span>
        <div style={sellingRow}>
          <AssetAvatar asset={asset} size={56} imageUrl={imageUrl} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={assetNameStyle}>{selling.name}</span>
            {selling.sub && <span style={sellingSub}>{selling.sub}</span>}
          </div>
        </div>
      </div>

      {/* You'll pay to list */}
      <div style={ws.reviewSection}>
        <div style={headerRow}>
          <span style={ws.reviewSectionLabel}>You&apos;ll pay to list</span>
          {feeSelect}
        </div>

        {isKontor ? (
          <>
            <div style={amountRow}>
              <div>
                <div style={bigNumber}>
                  {kontorTotalSats != null
                    ? `≈ ${formatSats(kontorTotalSats)}`
                    : "…"}
                </div>
                {kontorTotalSats != null &&
                formatUsd(kontorTotalSats, btcUsd) ? (
                  <div style={usdLine}>
                    ≈ {formatUsd(kontorTotalSats, btcUsd)}
                  </div>
                ) : null}
              </div>
              <div style={satsTag}>
                <BtcGoldIcon size={22} />
                <span>Sats</span>
              </div>
            </div>
            <div style={divider} />
            <div style={breakRow}>
              <span style={breakLabel}>
                Listing fee
                <InfoHint text={FEE_HINTS.listing} />
              </span>
              {paidWithCredit ? (
                <span style={{ ...breakValue, color: webTokens.success }}>
                  1 credit
                </span>
              ) : feeWaived ? (
                <span style={{ ...breakValue, color: webTokens.success }}>
                  Free
                </span>
              ) : kontorListingSats != null ? (
                <SatsValue sats={kontorListingSats} btcUsd={btcUsd} />
              ) : (
                <span style={breakValue}>
                  {kontorListingLoading ? "…" : "—"}
                </span>
              )}
            </div>
            <div style={breakRow}>
              <span style={breakLabel}>
                Attach miner fee
                <InfoHint
                  text={`Estimated from a recent on-chain attach reveal at ${
                    feeRate ?? estimates?.halfHourFee ?? "…"
                  } sat/vB (assumes one funding input); the exact total is set when you sign.`}
                />
              </span>
              {kontorMinerFeeSats != null ? (
                <div style={{ textAlign: "right" }}>
                  <div style={breakValue}>
                    ≈ {formatSats(kontorMinerFeeSats)} SATS
                  </div>
                  {formatUsd(kontorMinerFeeSats, btcUsd) ? (
                    <div style={usdLine}>
                      {formatUsd(kontorMinerFeeSats, btcUsd)}
                    </div>
                  ) : null}
                </div>
              ) : (
                <span style={breakValue}>…</span>
              )}
            </div>
            {kontorListingError && (
              <span style={ws.errorText}>
                Couldn&apos;t estimate fees: {kontorListingError.message}
              </span>
            )}
          </>
        ) : (
          <>
            <div style={amountRow}>
              <div>
                <div style={bigNumber}>
                  {cost ? formatSats(cost.total) : previewLoading ? "…" : "—"}
                </div>
                {totalUsd && <div style={usdLine}>{totalUsd}</div>}
              </div>
              <div style={satsTag}>
                <BtcGoldIcon size={22} />
                <span>Sats</span>
              </div>
            </div>

            {cost && (
              <>
                <div style={divider} />
                {cost.attach > 0 && (
                  <div style={breakRow}>
                    <span style={breakLabel}>
                      Attach fee
                      <InfoHint text={FEE_HINTS.attach} />
                    </span>
                    <SatsValue sats={cost.attach} btcUsd={btcUsd} />
                  </div>
                )}
                {cost.network > 0 && (
                  <div style={breakRow}>
                    <span style={breakLabel}>
                      Network fee
                      <InfoHint text={FEE_HINTS.network} />
                    </span>
                    <SatsValue sats={cost.network} btcUsd={btcUsd} />
                  </div>
                )}
                <div style={breakRow}>
                  <span style={breakLabel}>
                    Listing fee
                    <InfoHint text={FEE_HINTS.listing} />
                  </span>
                  {paidWithCredit ? (
                    <span style={{ ...breakValue, color: webTokens.success }}>
                      1 credit
                    </span>
                  ) : feeWaived || cost.listing === 0 ? (
                    <span style={{ ...breakValue, color: webTokens.success }}>
                      Free
                    </span>
                  ) : (
                    <SatsValue sats={cost.listing} btcUsd={btcUsd} />
                  )}
                </div>
              </>
            )}

            {previewError && !cost && (
              <span style={ws.errorText}>
                Couldn&apos;t estimate fees: {previewError.message}
              </span>
            )}
          </>
        )}
      </div>

      {/* You'll receive when it sells */}
      <div style={ws.reviewSection}>
        <span style={ws.reviewSectionLabel}>You&apos;ll receive when it sells</span>
        <div style={amountRow}>
          <div>
            <div style={bigNumber}>{formatSats(priceSats)}</div>
            {priceUsd && <div style={usdLine}>{priceUsd}</div>}
          </div>
          <div style={satsTag}>
            <BtcGoldIcon size={22} />
            <span>Sats</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSign}
        disabled={isSubmitting || !canSign}
        className={classNames?.button}
        style={ws.withDisabled(ws.primaryButton, isSubmitting || !canSign)}
      >
        {isSubmitting ? "Signing…" : "Sign"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className={classNames?.buttonSecondary}
        style={ws.withDisabled(ws.textButton, isSubmitting)}
      >
        Cancel
      </button>
    </>
  );
}
