import { useEffect } from "react";
import { useAssets } from "../hooks/useAssets.js";
import {
  useSellOrder,
  type UseSellOrderOptions,
  type UseSellOrderResult,
} from "../hooks/useSellOrder.js";
import {
  isSellFormValid,
  showQuantityForAsset,
} from "./sellFormValidation.js";
import { assetBalanceLabel, assetKey } from "./format.js";

export interface UseSellOrderFormControllerResult extends UseSellOrderResult {
  assets: ReturnType<typeof useAssets>;
  showQuantity: boolean;
  submitDisabled: boolean;
  /** Normalized balance of the selected asset for the Max button (or null). */
  maxQuantity: string | null;
  /** Epoch ms of the last balances fetch, or null (forwarded from useAssets). */
  lastFetchedAt: number | null;
  /** True while balances are being (re)fetched (forwarded from useAssets). */
  isFetching: boolean;
  /** Re-fetch all owned balances, bypassing the cache (forwarded from useAssets). */
  refresh: () => void;
}

/**
 * Shared controller for the platform-specific `SellOrderForm` components.
 * Wraps `useSellOrder` + `useAssets` and exposes the derived flags
 * (`showQuantity`, `submitDisabled`, `maxQuantity`) plus the balances
 * freshness/refresh controls used by both renderers.
 */
export function useSellOrderFormController(
  options?: UseSellOrderOptions,
): UseSellOrderFormControllerResult {
  const sellOrder = useSellOrder(options);
  const assets = useAssets();

  const selected = sellOrder.formValues.asset;

  // Refreshing balances re-fetches new option objects (and may drop an asset the
  // wallet no longer holds). Re-point the selection at the matching fresh option
  // by key — so Max / balance-cap validation use current numbers — or clear it
  // when it's gone, rather than leaving a stale/invalid snapshot selected. Only
  // reconcile on the form step; `confirm`/`progress` work off captured params.
  const { setFormValues, step } = sellOrder;
  const { allAssets } = assets;
  useEffect(() => {
    if (step !== "form" || !selected) return;
    const key = assetKey(selected);
    const fresh = allAssets.find((a) => assetKey(a) === key) ?? null;
    if (fresh !== selected) setFormValues({ asset: fresh });
  }, [allAssets, selected, step, setFormValues]);

  const showQuantity = showQuantityForAsset(selected);
  const submitDisabled = !isSellFormValid(sellOrder.formValues);
  const maxQuantity =
    selected && showQuantity ? assetBalanceLabel(selected) || null : null;

  return {
    ...sellOrder,
    assets,
    showQuantity,
    submitDisabled,
    maxQuantity,
    lastFetchedAt: assets.lastFetchedAt,
    isFetching: assets.isFetching,
    refresh: assets.refresh,
  };
}
