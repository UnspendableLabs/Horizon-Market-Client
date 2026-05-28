import type { CSSProperties } from "react";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { useSwapConfirmation } from "../hooks/useSwapConfirmation.js";
import { cx, formatAssetLabel, truncate } from "../internal/format.js";
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
  className?: string;
  classNames?: SwapConfirmationClassNames;
  style?: CSSProperties;
}

const rootStyle: CSSProperties = { ...ws.cardRoot, maxWidth: 480 };

export function SwapConfirmation({
  swap,
  mode,
  fillParams,
  defaultSatsPerVbyte,
  onBuySuccess,
  onDelistSuccess,
  onError,
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
    retry,
    reset,
  } = useSwapConfirmation({
    swapId: swap.id,
    defaultSatsPerVbyte,
    onBuySuccess,
    onDelistSuccess,
    onError,
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

  if (step === "confirm") {
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
            label={mode === "buy" ? "Seller" : "Listing"}
            value={
              mode === "buy"
                ? truncate(swap.sellerAddress)
                : `${swap.listingType} · ${truncate(swap.id)}`
            }
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
          onClick={() =>
            mode === "buy" ? void confirmPurchase(fillParams) : void delist()
          }
          className={classNames?.button}
          style={ws.primaryButton}
        >
          {mode === "buy" ? "Confirm Purchase" : "Delist"}
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
        onComplete={reset}
        completeLabel="Done"
        classNames={{
          button: classNames?.button,
          buttonSecondary: classNames?.buttonSecondary,
        }}
      />
    </div>
  );
}
