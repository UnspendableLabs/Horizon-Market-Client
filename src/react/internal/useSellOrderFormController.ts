import { useEffect } from "react";
import { useHorizonMarket } from "../context.js";
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
import { assetBalanceLabel, assetKey, mempoolTxUrl } from "./format.js";

/**
 * Derived view of the result step, shared by both renderers so the "submitted
 * vs live" messaging and the pending-tx mempool link stay identical.
 */
export interface SellResultView {
  /** A freshly created listing whose funding tx hasn't confirmed yet. */
  pendingConfirmation: boolean;
  /** mempool.space link to the pending funding tx, or null. */
  trackUrl: string | null;
  /** Success banner copy, or undefined when not on a successful result. */
  successMessage: string | undefined;
}

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
  /** Placeholder for the asset field: loading / empty / prompt. */
  assetPlaceholder: string;
  /** Per-group balance-load errors, pre-formatted for display. */
  nonFatalErrors: string[];
  /** Derived result-step messaging + pending-tx link (see {@link SellResultView}). */
  resultView: SellResultView;
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
  const { network, kontorNetwork } = useHorizonMarket();

  const selected = sellOrder.formValues.asset;

  // Refreshing balances re-fetches new option objects (and may drop an asset the
  // wallet no longer holds). Re-point the selection at the matching fresh option
  // by key — so Max / balance-cap validation use current numbers — or clear it
  // when it's gone, rather than leaving a stale/invalid snapshot selected. Only
  // reconcile on the form step; `confirm`/`progress` work off captured params.
  const { setFormValues, step } = sellOrder;
  const { allAssets, lastFetchedAt, isFetching } = assets;
  useEffect(() => {
    if (step !== "form" || !selected) return;
    const key = assetKey(selected);
    const fresh = allAssets.find((a) => assetKey(a) === key);
    if (fresh) {
      if (fresh !== selected) setFormValues({ asset: fresh });
      return;
    }
    // No match. Only clear a stale selection once balances have actually loaded
    // — otherwise a pre-selected `initialAsset` (e.g. launched from a wallet
    // balance) would be wiped during the first fetch, before `allAssets` fills.
    if (lastFetchedAt != null && !isFetching) setFormValues({ asset: null });
  }, [allAssets, selected, step, setFormValues, lastFetchedAt, isFetching]);

  const showQuantity = showQuantityForAsset(selected);
  const submitDisabled = !isSellFormValid(sellOrder.formValues);
  const maxQuantity =
    selected && showQuantity ? assetBalanceLabel(selected) || null : null;

  const assetPlaceholder =
    assets.isFetching && !assets.allAssets.length
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

  // Result-step view. A freshly created listing whose asset UTXO isn't confirmed
  // yet (counterparty attach / zeld transfer prep) won't appear in the market
  // until its funding tx confirms — so it's "submitted", not "live", and we
  // surface a mempool.space link to that tx. `funded` can arrive falsy-but-not-
  // strictly-false over the wire, so mirror the falsy check for both.
  const successResult =
    sellOrder.status === "success" ? sellOrder.result : null;
  const pendingConfirmation =
    Boolean(successResult?.created) && !successResult?.swap.funded;
  // The tx to track differs by listing type. Counterparty attach / zeld transfer
  // prep create a NEW asset UTXO, so the funding tx is that UTXO's txid. Ordinals
  // reuse the existing inscription UTXO — nothing is funded on-chain — so the
  // pending tx is the standalone platform-fee payment.
  const swap = successResult?.swap;
  const fundingTxid = !swap
    ? null
    : swap.listingType === "ordinal"
      ? swap.onChainPayment?.txid ?? swap.txId ?? null
      : swap.assetUtxoId?.split(":")[0] ?? swap.txId ?? null;
  const resultView: SellResultView = {
    pendingConfirmation,
    trackUrl: pendingConfirmation
      ? mempoolTxUrl(network, kontorNetwork, fundingTxid)
      : null,
    successMessage: successResult
      ? !successResult.created
        ? "Listing already exists (no changes)."
        : successResult.swap.funded
          ? "Your listing is live!"
          : "Sell order submitted!"
      : undefined,
  };

  return {
    ...sellOrder,
    assets,
    showQuantity,
    submitDisabled,
    maxQuantity,
    lastFetchedAt: assets.lastFetchedAt,
    isFetching: assets.isFetching,
    refresh: assets.refresh,
    assetPlaceholder,
    nonFatalErrors,
    resultView,
  };
}
