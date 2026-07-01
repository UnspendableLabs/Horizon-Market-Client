import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import {
  counterpartyXcpFirst,
  cx,
  formatRelativeTime,
  kontorKorFirst,
  mempoolTxUrl,
} from "../internal/format.js";
import { AssetSelect } from "../internal/AssetSelect.web.js";
import { ResultActions } from "../internal/ResultActions.web.js";
import { SellReview } from "../internal/SellReview.web.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
import { useSellOrderFormController } from "../internal/useSellOrderFormController.js";
import { useSellReview } from "../internal/useSellReview.js";
import {
  WorkflowProgress,
  type WorkflowProgressClassNames,
} from "./WorkflowProgress.web.js";

export interface SellOrderFormClassNames {
  root?: string;
  label?: string;
  input?: string;
  dropdown?: string;
  button?: string;
  buttonSecondary?: string;
  summary?: string;
  progress?: WorkflowProgressClassNames;
  error?: string;
  success?: string;
}

export interface SellOrderFormProps {
  defaultSatsPerVbyte?: number;
  onSuccess?: (swap: AtomicSwap, created: boolean) => void;
  onError?: (error: Error) => void;
  /**
   * Dismiss handler. When provided, the result screen shows a "Close" button
   * beside "New order" (e.g. to close the surrounding modal).
   */
  onClose?: () => void;
  className?: string;
  classNames?: SellOrderFormClassNames;
  style?: CSSProperties;
}

const rootStyle: CSSProperties = ws.panelBody;

const updatedRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const refreshButton: CSSProperties = {
  ...ws.secondaryButton,
  padding: "4px 10px",
  fontSize: 12,
};

const maxButton: CSSProperties = {
  ...ws.secondaryButton,
  padding: "4px 10px",
  fontSize: 12,
  alignSelf: "flex-start",
};

const pendingNote: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  lineHeight: 1.5,
};

const mempoolLink: CSSProperties = {
  color: webTokens.primary,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

interface AssetGroupDef {
  label: string;
  options: AssetOption[];
}

export function SellOrderForm({
  defaultSatsPerVbyte,
  onSuccess,
  onError,
  onClose,
  className,
  classNames,
  style,
}: SellOrderFormProps) {
  const {
    assets,
    showQuantity,
    submitDisabled,
    maxQuantity,
    lastFetchedAt,
    isFetching,
    refresh,
    step,
    formValues,
    setFormValues,
    submitForm,
    confirmAndSell,
    isSubmitting,
    goBack,
    retry,
    reset,
    steps,
    totalSteps,
    status,
    result,
    error,
  } = useSellOrderFormController({ defaultSatsPerVbyte, onSuccess, onError });

  const { network, kontorNetwork } = useHorizonMarket();

  // Fee rate + cost preview + live price for the review screen. Stays idle until
  // the confirm step is shown (so it never quotes while the form is being filled).
  const review = useSellReview({
    formValues,
    defaultSatsPerVbyte,
    active: step === "confirm",
  });

  const groups: AssetGroupDef[] = useMemo(
    () => [
      {
        label: "Counterparty",
        options: counterpartyXcpFirst(assets.counterpartyAssets),
      },
      { label: "ZELD", options: assets.zeldAssets },
      {
        label: "Kontor",
        options: kontorKorFirst([...assets.korAssets, ...assets.kontorNfts]),
      },
      { label: "Ordinals", options: assets.ordinals },
    ],
    [
      assets.counterpartyAssets,
      assets.zeldAssets,
      assets.korAssets,
      assets.kontorNfts,
      assets.ordinals,
    ],
  );

  const root = { ...rootStyle, ...style };

  if (step === "form") {
    const assetPlaceholder =
      isFetching && !assets.allAssets.length
        ? "Loading your assets…"
        : assets.isEmpty
          ? "No assets to sell"
          : "Select an asset…";
    const nonFatalErrors = [
      assets.errors.counterparty &&
        `Counterparty: ${assets.errors.counterparty.message}`,
      assets.errors.zeld && `ZELD: ${assets.errors.zeld.message}`,
      assets.errors.ordinals && `Ordinals: ${assets.errors.ordinals.message}`,
      assets.errors.kontor && `Kontor: ${assets.errors.kontor.message}`,
    ].filter((m): m is string => Boolean(m));

    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <div style={updatedRow}>
          <span style={ws.mutedText}>
            Updated {formatRelativeTime(lastFetchedAt)}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={isFetching}
            className={classNames?.buttonSecondary}
            style={ws.withDisabled(refreshButton, isFetching)}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className={classNames?.label} style={ws.label}>
          <span>Asset</span>
          <AssetSelect
            groups={groups}
            value={formValues.asset}
            onChange={(asset) => setFormValues({ asset })}
            placeholder={assetPlaceholder}
            disabled={!assets.allAssets.length}
            className={classNames?.dropdown}
          />
        </div>
        {nonFatalErrors.length > 0 && (
          <div className={classNames?.error} style={ws.errorText}>
            {nonFatalErrors.join(" · ")}
          </div>
        )}
        {showQuantity && (
          <label className={classNames?.label} style={ws.label}>
            Quantity
            <input
              type="text"
              inputMode="decimal"
              value={formValues.quantity}
              onChange={(e) =>
                setFormValues({
                  quantity: e.target.value.replace(/[^0-9.]/g, ""),
                })
              }
              placeholder="0"
              className={classNames?.input}
              style={ws.input}
            />
            {maxQuantity && (
              <button
                type="button"
                onClick={() => setFormValues({ quantity: maxQuantity })}
                className={classNames?.buttonSecondary}
                style={maxButton}
              >
                Max ({maxQuantity})
              </button>
            )}
          </label>
        )}
        <label className={classNames?.label} style={ws.label}>
          Price (sats)
          <input
            type="text"
            inputMode="numeric"
            value={formValues.priceSats}
            onChange={(e) =>
              setFormValues({
                priceSats: e.target.value.replace(/[^0-9]/g, ""),
              })
            }
            placeholder="0"
            className={classNames?.input}
            style={ws.input}
          />
        </label>
        {error && (
          <div className={classNames?.error} style={ws.errorText}>
            {error.message}
          </div>
        )}
        <button
          type="button"
          onClick={submitForm}
          className={classNames?.button}
          disabled={submitDisabled}
          style={ws.withDisabled(ws.primaryButton, submitDisabled)}
        >
          Review Order
        </button>
      </div>
    );
  }

  if (step === "confirm" && formValues.asset) {
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <SellReview
          asset={formValues.asset}
          quantity={formValues.quantity}
          priceSats={Number(formValues.priceSats)}
          review={review}
          isSubmitting={isSubmitting}
          onSign={() => void confirmAndSell({ satsPerVbyte: review.feeRate })}
          onCancel={goBack}
          classNames={{
            button: classNames?.button,
            buttonSecondary: classNames?.buttonSecondary,
            summary: classNames?.summary,
          }}
        />
      </div>
    );
  }

  if (step === "progress") {
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <WorkflowProgress
          steps={steps}
          totalSteps={totalSteps}
          status={status}
          classNames={classNames?.progress}
        />
      </div>
    );
  }

  // result step. A freshly created listing whose asset UTXO isn't confirmed yet
  // (counterparty attach / zeld transfer prep) won't appear in the marketplace
  // until its funding tx confirms — so it's "submitted", not "live", and we
  // surface a mempool.space link to that tx.
  const successResult = status === "success" ? result : null;
  // Pending = a freshly created listing whose funding tx hasn't confirmed yet.
  // `funded` can arrive falsy-but-not-strictly-false (e.g. undefined) over the
  // wire, so mirror the falsy check used for the "Sell order submitted!" message
  // below rather than `=== false`, otherwise the mempool note never renders.
  const pendingConfirmation =
    Boolean(successResult?.created) && !successResult?.swap.funded;
  // The tx to track differs by listing type. Counterparty attach / zeld transfer
  // prep create a NEW asset UTXO, so the funding tx is that UTXO's txid. Ordinals
  // reuse the existing inscription UTXO — nothing is funded on-chain — so the
  // pending tx is the standalone platform-fee payment; using assetUtxoId there
  // would link to the inscription's txid, not the payment.
  const swap = successResult?.swap;
  const fundingTxid = !swap
    ? null
    : swap.listingType === "ordinal"
      ? swap.onChainPayment?.txid ?? swap.txId ?? null
      : swap.assetUtxoId?.split(":")[0] ?? swap.txId ?? null;
  const trackUrl = pendingConfirmation
    ? mempoolTxUrl(network, kontorNetwork, fundingTxid)
    : null;

  const successMessage = successResult
    ? !successResult.created
      ? "Listing already exists (no changes)."
      : successResult.swap.funded
        ? "Your listing is live!"
        : "Sell order submitted!"
    : undefined;

  return (
    <div className={cx(classNames?.root, className)} style={root}>
      <WorkflowProgress
        steps={steps}
        totalSteps={totalSteps}
        status={status}
        successMessage={successMessage}
        errorMessage={error?.message}
        classNames={classNames?.progress}
      />
      {pendingConfirmation && (
        <div className={classNames?.success} style={pendingNote}>
          Your order will appear in the marketplace once its transaction is
          confirmed on-chain.
          {trackUrl && (
            <>
              {" "}
              <a
                href={trackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={mempoolLink}
              >
                Track it on mempool.space →
              </a>
            </>
          )}
        </div>
      )}
      <ResultActions
        isError={status === "error"}
        onBack={goBack}
        onRetry={retry}
        onComplete={reset}
        completeLabel="New order"
        onClose={onClose}
        classNames={{
          button: classNames?.button,
          buttonSecondary: classNames?.buttonSecondary,
        }}
      />
    </div>
  );
}
