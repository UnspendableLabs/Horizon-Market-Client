import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { assetKey, cx, describeAsset } from "../internal/format.js";
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
  search?: string;
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
    search,
    setSearch,
    showQuantity,
    submitDisabled,
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
    for (const a of [
      assets.zeldOption,
      ...assets.counterpartyAssets,
      ...assets.ordinals,
    ]) {
      m.set(assetKey(a), a);
    }
    return m;
  }, [assets.zeldOption, assets.counterpartyAssets, assets.ordinals]);

  const root = { ...rootStyle, ...style };

  if (step === "form") {
    const selectedValue = formValues.asset ? assetKey(formValues.asset) : "";
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <label className={classNames?.label} style={ws.label}>
          Search counterparty assets
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ASSET_NAME"
            className={classNames?.search}
            style={ws.input}
          />
        </label>
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
            <option value="">Select an asset…</option>
            <optgroup label="ZELD">
              <option value={assetKey(assets.zeldOption)}>ZELD</option>
            </optgroup>
            <optgroup label="Counterparty">
              {assets.isSearching && (
                <option disabled value="">
                  Searching…
                </option>
              )}
              {assets.counterpartyError && (
                <option disabled value="">
                  Search failed: {assets.counterpartyError.message}
                </option>
              )}
              {assets.counterpartyAssets.map((a) => {
                const k = assetKey(a);
                return (
                  <option key={k} value={k}>
                    {describeAsset(a)}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label="Ordinals">
              {assets.isLoadingOrdinals && (
                <option disabled value="">
                  Loading ordinals…
                </option>
              )}
              {assets.ordinalsError && (
                <option disabled value="">
                  Ordinals unavailable: {assets.ordinalsError.message}
                </option>
              )}
              {assets.ordinals.map((a) => {
                const k = assetKey(a);
                return (
                  <option key={k} value={k}>
                    {describeAsset(a)}
                  </option>
                );
              })}
            </optgroup>
          </select>
        </label>
        {showQuantity && (
          <label className={classNames?.label} style={ws.label}>
            Quantity
            <input
              type="text"
              inputMode="numeric"
              value={formValues.quantity}
              onChange={(e) =>
                setFormValues({
                  quantity: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
              placeholder="0"
              className={classNames?.input}
              style={ws.input}
            />
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
        <div className={classNames?.summary} style={ws.summaryStack}>
          <SummaryRow label="Asset" value={describeAsset(formValues.asset)} />
          {formValues.asset.type !== "ordinal" && (
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
