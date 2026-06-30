import type { CSSProperties } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { webTokens } from "../theme.js";
import { formatSats, formatUsd, sellingDisplay } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.web.js";
import {
  FEE_OPTIONS,
  type FeeOption,
  type UseSellReviewResult,
} from "./useSellReview.js";
import * as ws from "./styles.web.js";

const FEE_LABELS: Record<FeeOption, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

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
  fontSize: 40,
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

const noteText: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  lineHeight: 1.5,
};

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
    previewLoading,
    previewError,
    kontorListingSats,
    kontorListingLoading,
    kontorMinerFeeSats,
    kontorTotalSats,
  } = review;

  const selling = sellingDisplay(asset, quantity);
  const priceUsd = formatUsd(priceSats, btcUsd);
  const totalUsd = cost ? formatUsd(cost.total, btcUsd) : null;

  const attachNote =
    asset.type === "counterparty" && (cost?.attach ?? 0) > 0
      ? `Your ${asset.assetName} isn't on a dedicated UTXO yet, so it's moved there automatically before the listing goes live.`
      : asset.type === "zeld" && cost && (cost.attach > 0 || !feeWaived)
        ? "The listing fee is sent in the same transaction as your ZELD transfer to create the swap UTXO."
        : null;

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
          <AssetAvatar asset={asset} size={56} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={assetNameStyle}>{selling.name}</span>
            {selling.sub && <span style={usdLine}>{selling.sub}</span>}
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
              <span style={usdLine}>Listing fee</span>
              {kontorListingSats != null ? (
                <SatsValue sats={kontorListingSats} btcUsd={btcUsd} />
              ) : (
                <span style={breakValue}>
                  {kontorListingLoading ? "…" : "—"}
                </span>
              )}
            </div>
            <div style={breakRow}>
              <span style={usdLine}>Attach miner fee</span>
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
            <p style={noteText}>
              Miner fee estimated from a recent on-chain attach reveal at{" "}
              {feeRate ?? estimates?.halfHourFee ?? "…"} sat/vB (assumes one
              funding input); the exact total is set when you sign.
            </p>
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
                    <span style={usdLine}>Attach fee</span>
                    <SatsValue sats={cost.attach} btcUsd={btcUsd} />
                  </div>
                )}
                {cost.network > 0 && (
                  <div style={breakRow}>
                    <span style={usdLine}>Network fee</span>
                    <SatsValue sats={cost.network} btcUsd={btcUsd} />
                  </div>
                )}
                <div style={breakRow}>
                  <span style={usdLine}>Listing fee</span>
                  {feeWaived || cost.listing === 0 ? (
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

            {attachNote && <p style={noteText}>{attachNote}</p>}
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
        disabled={isSubmitting}
        className={classNames?.button}
        style={ws.withDisabled(ws.primaryButton, isSubmitting)}
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
