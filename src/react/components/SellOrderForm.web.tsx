import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import {
  assetKey,
  cx,
  describeAsset,
  formatRelativeTime,
} from "../internal/format.js";
import { ResultActions } from "../internal/ResultActions.web.js";
import { SummaryRow } from "../internal/SummaryRow.web.js";
import * as ws from "../internal/styles.web.js";
import { useSellOrderFormController } from "../internal/useSellOrderFormController.js";
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
  className?: string;
  classNames?: SellOrderFormClassNames;
  style?: CSSProperties;
}

const rootStyle: CSSProperties = { ...ws.cardRoot, maxWidth: 480 };

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

interface AssetGroupDef {
  label: string;
  options: AssetOption[];
}

export function SellOrderForm({
  defaultSatsPerVbyte,
  onSuccess,
  onError,
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

  const assetIndex = useMemo(() => {
    const m = new Map<string, AssetOption>();
    for (const a of assets.allAssets) m.set(assetKey(a), a);
    return m;
  }, [assets.allAssets]);

  const groups: AssetGroupDef[] = useMemo(
    () => [
      { label: "Counterparty", options: assets.counterpartyAssets },
      { label: "ZELD", options: assets.zeldAssets },
      { label: "KOR", options: assets.korAssets },
      { label: "Kontor NFTs", options: assets.kontorNfts },
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
    const selectedValue = formValues.asset ? assetKey(formValues.asset) : "";
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
        <label className={classNames?.label} style={ws.label}>
          Asset
          <select
            value={selectedValue}
            onChange={(e) =>
              setFormValues({ asset: assetIndex.get(e.target.value) ?? null })
            }
            className={classNames?.dropdown}
            style={ws.input}
          >
            <option value="">
              {isFetching && !assets.allAssets.length
                ? "Loading your assets…"
                : assets.isEmpty
                  ? "No assets to sell"
                  : "Select an asset…"}
            </option>
            {groups.map((group) =>
              group.options.length === 0 ? null : (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((a) => {
                    const k = assetKey(a);
                    return (
                      <option key={k} value={k}>
                        {describeAsset(a)}
                      </option>
                    );
                  })}
                </optgroup>
              ),
            )}
          </select>
        </label>
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
    const showSummaryQuantity =
      formValues.asset.type !== "ordinal" &&
      formValues.asset.type !== "kontor-nft";
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <div className={classNames?.summary} style={ws.summaryStack}>
          <SummaryRow label="Asset" value={describeAsset(formValues.asset)} />
          {showSummaryQuantity && (
            <SummaryRow label="Quantity" value={formValues.quantity} />
          )}
          <SummaryRow
            label="Price"
            value={`${Number(formValues.priceSats).toLocaleString()} sats`}
          />
        </div>
        <div style={ws.actionsRow}>
          <button
            type="button"
            onClick={goBack}
            className={classNames?.buttonSecondary}
            style={{ ...ws.secondaryButton, flex: 1 }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void confirmAndSell()}
            disabled={isSubmitting}
            className={classNames?.button}
            style={ws.withDisabled(
              { ...ws.primaryButton, flex: 1 },
              isSubmitting,
            )}
          >
            {isSubmitting ? "Selling…" : "Sell"}
          </button>
        </div>
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
        successMessage={
          status === "success" && result
            ? result.created
              ? "Your listing is live!"
              : "Listing already exists (no changes)."
            : undefined
        }
        errorMessage={error?.message}
        classNames={classNames?.progress}
      />
      <ResultActions
        isError={status === "error"}
        onBack={goBack}
        onRetry={retry}
        onComplete={reset}
        completeLabel="New order"
        classNames={{
          button: classNames?.button,
          buttonSecondary: classNames?.buttonSecondary,
        }}
      />
    </div>
  );
}
