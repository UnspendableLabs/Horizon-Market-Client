import type { CSSProperties, ReactNode } from "react";
import { useHorizonMarket } from "../context.js";
import {
  assetImageUrl,
  cx,
  formatSats,
  mempoolTxUrl,
} from "../internal/format.js";
import { AssetAvatar, BtcGoldIcon } from "../internal/icons.web.js";
import { ResultActions } from "../internal/ResultActions.web.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
import {
  useWithdraw,
  WITHDRAW_FEE_LABELS as FEE_LABELS,
  WITHDRAW_FEE_OPTIONS,
  type WithdrawFeeOption,
  type WithdrawTarget,
} from "../hooks/useWithdraw.js";

export interface WithdrawFormClassNames {
  root?: string;
  label?: string;
  input?: string;
  button?: string;
  buttonSecondary?: string;
  error?: string;
  success?: string;
}

export interface WithdrawFormProps {
  /** The asset to withdraw (a BTC balance or an owned asset). */
  target: WithdrawTarget;
  onSuccess?: (txid: string) => void;
  onError?: (error: Error) => void;
  /** Dismiss handler — shows a "Close" button on the result screen. */
  onClose?: () => void;
  className?: string;
  classNames?: WithdrawFormClassNames;
  style?: CSSProperties;
}


const rootStyle: CSSProperties = ws.panelBody;

const maxButton: CSSProperties = {
  ...ws.secondaryButton,
  padding: "4px 10px",
  fontSize: 12,
  alignSelf: "flex-start",
};

const availableRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
};

const monoValue: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: webTokens.fontSizeSm,
  wordBreak: "break-all",
  color: webTokens.text,
};

const centerNote: CSSProperties = {
  textAlign: "center",
  color: webTokens.textMuted,
  fontSize: webTokens.fontSizeSm,
  padding: `${webTokens.spacingLg} 0`,
};

const mempoolLink: CSSProperties = {
  color: webTokens.primary,
  fontWeight: 600,
  textDecoration: "none",
  wordBreak: "break-all",
};

// ─── Review-screen styles (mirror SellReview.web.tsx) ────────────────────────

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

const sellingSub: CSSProperties = {
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
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

/** A 56px rounded tile holding the BTC gold mark (BTC has no AssetOption). */
const btcTile: CSSProperties = {
  width: 56,
  height: 56,
  flexShrink: 0,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: webTokens.backgroundElevated,
  border: `1px solid ${webTokens.border}`,
};

/** The withdraw target's avatar/logo — asset image, or the BTC gold mark. */
function TargetAvatar({
  target,
  baseUrl,
}: {
  target: WithdrawTarget;
  baseUrl: string;
}): ReactNode {
  if (target.type === "btc") {
    return (
      <div style={btcTile}>
        <BtcGoldIcon size={32} />
      </div>
    );
  }
  return (
    <AssetAvatar asset={target} size={56} imageUrl={assetImageUrl(baseUrl, target)} />
  );
}

/**
 * Withdraw (send) flow for a single wallet asset, rendered inside a {@link Modal}
 * by {@link WalletBalances}. Steps through `form → review → sending → result`.
 *
 * The fee rate is chosen on the form; moving to review composes and funds the
 * transaction (see {@link useWithdraw}) so the review shows the *exact* miner
 * fee. Confirming signs the transaction (prompting the wallet) then broadcasts,
 * so the wallet prompt fires on confirm, not on review.
 */
export function WithdrawForm({
  target,
  onSuccess,
  onError,
  onClose,
  className,
  classNames,
  style,
}: WithdrawFormProps) {
  const w = useWithdraw({ target, onSuccess, onError });
  const { network, kontorNetwork, baseUrl } = useHorizonMarket();

  const root = { ...rootStyle, ...style };

  // ─── Form step ─────────────────────────────────────────────────────────────
  if (w.step === "form") {
    const submitDisabled = w.submitDisabled;
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        {w.availableDisplay && (
          <div style={availableRow}>
            <span style={ws.mutedText}>Available</span>
            <span style={ws.mutedText}>
              {w.availableDisplay} {w.assetLabel}
            </span>
          </div>
        )}
        <label className={classNames?.label} style={ws.label}>
          {w.destinationLabel}
          <input
            type="text"
            value={w.formValues.destination}
            onChange={(e) => w.setFormValues({ destination: e.target.value.trim() })}
            placeholder={w.destinationPlaceholder}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className={classNames?.input}
            style={ws.input}
          />
        </label>
        {w.needsQuantity && (
          <label className={classNames?.label} style={ws.label}>
            Amount
            <input
              type="text"
              inputMode="decimal"
              value={w.formValues.quantity}
              onChange={(e) =>
                w.setFormValues({ quantity: e.target.value.replace(/[^0-9.]/g, "") })
              }
              placeholder="0"
              className={classNames?.input}
              style={ws.input}
            />
            {w.availableDisplay && w.kind !== "btc" && (
              <button
                type="button"
                onClick={() => w.setFormValues({ quantity: w.availableDisplay! })}
                className={classNames?.buttonSecondary}
                style={maxButton}
              >
                Max ({w.availableDisplay})
              </button>
            )}
          </label>
        )}

        {/*
          Fee rate is chosen here. For the Bitcoin family the review composes the
          tx and shows the exact fee; Kontor applies the rate at submit and the
          review shows an estimate.
        */}
        <label className={classNames?.label} style={ws.label}>
          Network fee
          <select
            value={w.feeOption}
            onChange={(e) => w.setFeeOption(e.target.value as WithdrawFeeOption)}
            style={ws.feeRateSelect}
            aria-label="Fee rate"
          >
            {WITHDRAW_FEE_OPTIONS.map((opt) => {
              const rate = w.rateFor(opt);
              return (
                <option key={opt} value={opt}>
                  {FEE_LABELS[opt]} · {rate ?? "…"} sat/vB
                </option>
              );
            })}
          </select>
        </label>

        {w.error && (
          <div className={classNames?.error} style={ws.errorText}>
            {w.error.message}
          </div>
        )}
        <button
          type="button"
          onClick={w.submitForm}
          disabled={submitDisabled}
          className={classNames?.button}
          style={ws.withDisabled(ws.primaryButton, submitDisabled)}
        >
          {w.isPreparing ? "Composing…" : "Review"}
        </button>
      </div>
    );
  }

  // ─── Review step (mirrors SellReview design) ─────────────────────────────────
  if (w.step === "confirm") {
    const display = w.withdrawingDisplay;
    const { exact: feeExact, sats: feeSats, usd: feeUsd } = w.reviewFee;
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        {/* You're withdrawing */}
        <div style={ws.reviewSection}>
          <span style={ws.reviewSectionLabel}>You&apos;re withdrawing</span>
          <div style={sellingRow}>
            <TargetAvatar target={target} baseUrl={baseUrl} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={assetNameStyle}>{display.name}</span>
              {display.sub && <span style={sellingSub}>{display.sub}</span>}
            </div>
          </div>
        </div>

        {/* To */}
        <div style={ws.reviewSection}>
          <span style={ws.reviewSectionLabel}>To</span>
          <span style={monoValue}>{w.formValues.destination}</span>
        </div>

        {/* Network fee — exact for the Bitcoin family, estimated for Kontor */}
        <div style={ws.reviewSection}>
          <span style={ws.reviewSectionLabel}>Network fee</span>
          <div style={amountRow}>
            <div>
              <div style={bigNumber}>
                {feeSats != null
                  ? `${feeExact ? "" : "≈ "}${formatSats(feeSats)}`
                  : "…"}
              </div>
              {feeUsd && (
                <div style={usdLine}>
                  {feeExact ? "" : "≈ "}
                  {feeUsd}
                </div>
              )}
            </div>
            <div style={satsTag}>
              <BtcGoldIcon size={22} />
              <span>Sats</span>
            </div>
          </div>
          {w.isKontor && (
            <span style={ws.mutedText}>
              Estimated at {w.feeRate ?? "…"} sat/vB — Kontor sets the exact fee
              when you confirm.
            </span>
          )}
        </div>

        {w.error && (
          <div className={classNames?.error} style={ws.errorText}>
            {w.error.message}
          </div>
        )}
        <div style={ws.actionsRow}>
          <button
            type="button"
            onClick={w.goBack}
            disabled={w.isSubmitting}
            className={classNames?.buttonSecondary}
            style={ws.withDisabled({ ...ws.secondaryButton, flex: 1 }, w.isSubmitting)}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void w.confirmAndSend()}
            disabled={w.isSubmitting}
            className={classNames?.button}
            style={ws.withDisabled({ ...ws.primaryButton, flex: 1 }, w.isSubmitting)}
          >
            {w.isSubmitting ? "Sending…" : "Confirm & send"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Progress step ───────────────────────────────────────────────────────────
  if (w.step === "progress") {
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <div style={centerNote}>Broadcasting your transaction…</div>
      </div>
    );
  }

  // ─── Result step ─────────────────────────────────────────────────────────────
  const txid = w.result?.txid ?? null;
  const trackUrl = txid ? mempoolTxUrl(network, kontorNetwork, txid) : null;
  return (
    <div className={cx(classNames?.root, className)} style={root}>
      {w.status === "success" ? (
        <div className={classNames?.success} style={ws.panelBody}>
          <div style={{ fontWeight: 700 }}>Sent!</div>
          {txid && (
            <div style={ws.label}>
              <span>Transaction</span>
              {trackUrl ? (
                <a
                  href={trackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={mempoolLink}
                >
                  {txid}
                </a>
              ) : (
                <span style={monoValue}>{txid}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={classNames?.error} style={ws.errorText}>
          {w.error?.message ?? "Something went wrong."}
        </div>
      )}
      <ResultActions
        isError={w.status === "error"}
        onBack={w.goBack}
        onRetry={w.retry}
        onComplete={w.reset}
        completeLabel="New withdrawal"
        onClose={onClose}
        classNames={{
          button: classNames?.button,
          buttonSecondary: classNames?.buttonSecondary,
        }}
      />
    </div>
  );
}
