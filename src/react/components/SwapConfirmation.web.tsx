import type { CSSProperties } from "react";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { useSwapConfirmation } from "../hooks/useSwapConfirmation.js";
import { useHorizonMarket } from "../context.js";
import {
  cx,
  errorDisplayMessage,
  formatAssetLabel,
  truncate,
} from "../internal/format.js";
import { BuyReview } from "../internal/BuyReview.web.js";
import { useBuyReview } from "../internal/useBuyReview.js";
import { kontorPreflightNotice } from "../internal/useKontorPreflight.js";
import { ResultActions } from "../internal/ResultActions.web.js";
import { SummaryRow } from "../internal/SummaryRow.web.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
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
    status,
    steps,
    totalSteps,
    successMessage,
    trackUrl,
    error,
    confirmPurchase,
    delist,
    isSubmitting,
    preflight,
    retry,
    reset,
  } = useSwapConfirmation({
    swapId: swap.id,
    mode,
    // Gates a Kontor delist on chain state before the button is offered — a
    // revoke spends the escrow, so a `detach` dropped for want of gas can never
    // be retried.
    swap,
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

  // Ordinals must be received on a taproot address. Auto-fill it from the
  // connected wallet so callers (e.g. SwapList) don't have to thread fillParams;
  // an explicit fillParams.buyerTaprootAddress still wins.
  const { addresses } = useHorizonMarket();
  const buyerTaprootAddress =
    swap.listingType === "ordinal" ? addresses?.p2tr : undefined;

  // Kontor delist only: why the revoke wouldn't execute (button disabled), or
  // that it couldn't be checked (button still enabled).
  const delistNotice = kontorPreflightNotice(preflight);
  const delistDisabled = isSubmitting || preflight.blockedReason !== null;

  const root = { ...rootStyle, ...style };

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
              ...(buyerTaprootAddress ? { buyerTaprootAddress } : {}),
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
            value={`${swap.price.toLocaleString("en-US")} sats`}
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
        {delistNotice && (
          <span
            role={delistNotice.tone === "blocked" ? "alert" : undefined}
            style={
              delistNotice.tone === "blocked" ? ws.errorText : ws.mutedText
            }
          >
            {delistNotice.text}
          </span>
        )}
        <button
          type="button"
          disabled={delistDisabled}
          onClick={() => void delist()}
          className={classNames?.button}
          style={ws.withDisabled(ws.primaryButton, delistDisabled)}
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

  return (
    <div className={cx(classNames?.root, className)} style={root}>
      <WorkflowProgress
        steps={steps}
        totalSteps={totalSteps}
        status={status}
        successMessage={successMessage}
        errorMessage={error ? errorDisplayMessage(error) : undefined}
        classNames={classNames?.progress}
      />
      {trackUrl && (
        <div style={pendingNote}>
          {"Your purchase is settling on-chain. "}
          <a
            href={trackUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={mempoolLink}
          >
            Track it on mempool.space →
          </a>
        </div>
      )}
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
