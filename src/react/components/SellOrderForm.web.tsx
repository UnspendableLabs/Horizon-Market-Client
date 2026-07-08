import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { cx, formatRelativeTime } from "../internal/format.js";
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
  /**
   * Asset to pre-select on the form — e.g. when the sell flow is opened from a
   * specific wallet balance. "New order" still resets to an empty form.
   */
  initialAsset?: AssetOption | null;
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

const trackList: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingXs,
  fontSize: webTokens.fontSizeSm,
};

export function SellOrderForm({
  defaultSatsPerVbyte,
  initialAsset,
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
    error,
    assetPlaceholder,
    nonFatalErrors,
    assetGroups,
    resultView,
  } = useSellOrderFormController({
    defaultSatsPerVbyte,
    initialAsset,
    onSuccess,
    onError,
  });

  // Fee rate + cost preview + live price for the review screen. Stays idle until
  // the confirm step is shown (so it never quotes while the form is being filled).
  const review = useSellReview({
    formValues,
    defaultSatsPerVbyte,
    active: step === "confirm",
  });

  const root = { ...rootStyle, ...style };

  if (step === "form") {
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
            groups={assetGroups}
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

  // result step. `resultView` (from the shared controller) carries the
  // "submitted vs live" messaging and the broadcast-tx mempool links so web and
  // native render identical result states.
  const { pendingConfirmation, trackTxs, successMessage } = resultView;

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
        </div>
      )}
      {trackTxs.length > 0 && (
        <div className={classNames?.success} style={trackList}>
          {trackTxs.map((tx) => (
            <a
              key={tx.url}
              href={tx.url}
              target="_blank"
              rel="noopener noreferrer"
              style={mempoolLink}
            >
              {tx.label}
            </a>
          ))}
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
