import type { CSSProperties } from "react";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { useSwapConfirmation } from "../hooks/useSwapConfirmation.js";
import { cx, formatAssetLabel, truncate } from "../internal/format.js";
import { BuyReview } from "../internal/BuyReview.web.js";
import { useBuyReview } from "../internal/useBuyReview.js";
import { ResultActions } from "../internal/ResultActions.web.js";
import { SummaryRow } from "../internal/SummaryRow.web.js";
import * as ws from "../internal/styles.web.js";
import {
  WorkflowProgress,
  type WorkflowProgressClassNames,
} from "./WorkflowProgress.web.js";

export interface SwapConfirmationClassNames {
  root?: string;
  details?: string;
  row?: string;
  rowLabel?: string;
  rowValue?: string;
  button?: string;
  buttonSecondary?: string;
  progress?: WorkflowProgressClassNames;
}

export interface SwapConfirmationProps {
  swap: AtomicSwap;
  mode: "buy" | "sell";
  fillParams?: Partial<FillSwapsParams>;
  defaultSatsPerVbyte?: number;
  onBuySuccess?: (sales: PendingSale[]) => void;
  onDelistSuccess?: () => void;
  onError?: (error: Error) => void;
  /** Called when the user dismisses the result screen (clicks "Done"). */
  onComplete?: () => void;
  className?: string;
  classNames?: SwapConfirmationClassNames;
  style?: CSSProperties;
}

const rootStyle: CSSProperties = ws.panelBody;

export function SwapConfirmation({
  swap,
  mode,
  fillParams,
  defaultSatsPerVbyte,
  onBuySuccess,
  onDelistSuccess,
  onError,
  onComplete,
  className,
  classNames,
  style,
}: SwapConfirmationProps) {
  const {
    step,
    buyStatus,
    delistStatus,
    buySteps,
    delistSteps,
    totalBuySteps,
    totalDelistSteps,
    sales,
    error,
    confirmPurchase,
    delist,
    isSubmitting,
    retry,
    reset,
  } = useSwapConfirmation({
    swapId: swap.id,
    defaultSatsPerVbyte,
    onBuySuccess,
    onDelistSuccess,
    onError,
  });

  // Fee rate + composed cost preview for the buy review. Stays idle until the
  // buy confirm step is shown (so it never composes a quote for a delist).
  const buyReview = useBuyReview({
    swap,
    defaultSatsPerVbyte,
    active: step === "confirm" && mode === "buy",
  });

  const root = { ...rootStyle, ...style };
  const status = mode === "buy" ? buyStatus : delistStatus;
  const steps = mode === "buy" ? buySteps : delistSteps;
  const totalSteps = mode === "buy" ? totalBuySteps : totalDelistSteps;

  const rowClassNames = {
    className: classNames?.row,
    labelClassName: classNames?.rowLabel,
    valueClassName: classNames?.rowValue,
  };

  if (step === "confirm" && mode === "buy") {
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <BuyReview
          swap={swap}
          review={buyReview}
          isSubmitting={isSubmitting}
          onConfirm={() =>
            void confirmPurchase({
              ...fillParams,
              ...(buyReview.feeRate != null
                ? { satsPerVbyte: buyReview.feeRate }
                : {}),
            })
          }
          onCancel={onComplete}
          classNames={{
            button: classNames?.button,
            buttonSecondary: classNames?.buttonSecondary,
          }}
        />
      </div>
    );
  }

  if (step === "confirm") {
    // Delist confirmation (mode === "sell") — a compact summary of the listing
    // the seller is removing.
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <div className={classNames?.details} style={ws.summaryStack}>
          <SummaryRow
            label="Asset"
            value={formatAssetLabel(swap)}
            mono
            {...rowClassNames}
          />
          <SummaryRow
            label="Price"
            value={`${swap.price.toLocaleString()} sats`}
            mono
            {...rowClassNames}
          />
          <SummaryRow
            label="Listing"
            value={`${swap.listingType} · ${truncate(swap.id)}`}
            mono
            {...rowClassNames}
          />
          {swap.expiresAt && (
            <SummaryRow
              label="Expires"
              value={new Date(swap.expiresAt).toLocaleString()}
              mono
              {...rowClassNames}
            />
          )}
        </div>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void delist()}
          className={classNames?.button}
          style={ws.withDisabled(ws.primaryButton, isSubmitting)}
        >
          {isSubmitting ? "Delisting…" : "Delist"}
        </button>
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

  const firstSale = sales?.[0];
  const successMessage =
    status === "success"
      ? mode === "buy"
        ? firstSale
          ? `Purchase complete! tx ${firstSale.txId.slice(0, 12)}…`
          : "Purchase complete!"
        : "Listing removed."
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
      <ResultActions
        isError={status === "error"}
        onBack={reset}
        onRetry={retry}
        onComplete={() => { reset(); onComplete?.(); }}
        completeLabel="Done"
        classNames={{
          button: classNames?.button,
          buttonSecondary: classNames?.buttonSecondary,
        }}
      />
    </div>
  );
}
