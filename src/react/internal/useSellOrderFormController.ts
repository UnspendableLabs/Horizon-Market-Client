import { useEffect, useMemo } from "react";
import { useHorizonMarket } from "../context.js";
import { useAssets, type AssetOption } from "../hooks/useAssets.js";
import {
  useSellOrder,
  type UseSellOrderOptions,
  type UseSellOrderResult,
} from "../hooks/useSellOrder.js";
import {
  isSellFormValid,
  showQuantityForAsset,
} from "./sellFormValidation.js";
import {
  assetBalanceLabel,
  assetKey,
  counterpartyXcpFirst,
  kontorKorFirst,
  mempoolTxUrl,
} from "./format.js";

/**
 * A labeled group of sellable assets (Counterparty / ZELD / Kontor / Ordinals),
 * already ordered (XCP-first, KOR-first) and filtered to non-empty. Shared by
 * both renderers so the grouping/order/labels can't drift between platforms;
 * each maps it to its own list shape (`{label,options}` ↔ SectionList
 * `{title,data}`).
 */
export interface AssetGroup {
  label: string;
  options: AssetOption[];
}

/** A broadcast tx surfaced on the result step, with its mempool link + label. */
export interface SellTrackTx {
  /** mempool.space transaction URL. */
  url: string;
  /** Ready-to-render link text (kind-specific when more than one tx). */
  label: string;
}

/**
 * Derived view of the result step, shared by both renderers so the "submitted
 * vs live" messaging and the tx mempool links stay identical.
 */
export interface SellResultView {
  /** A freshly created listing whose asset-funding tx hasn't confirmed yet. */
  pendingConfirmation: boolean;
  /**
   * mempool.space links to every tx the listing broadcast (attach and/or fee).
   * Empty when the listing opened with no new transaction.
   */
  trackTxs: SellTrackTx[];
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
  /** Sellable assets grouped + ordered for the picker (see {@link AssetGroup}). */
  assetGroups: AssetGroup[];
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

  // Grouped + ordered sellable assets, non-empty groups only. Hoisted here so the
  // group labels and the XCP-first / KOR-first ordering live in one place; the
  // web and native pickers just render this list in their own shape.
  const assetGroups: AssetGroup[] = useMemo(
    () =>
      [
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
      ].filter((g) => g.options.length > 0),
    [
      assets.counterpartyAssets,
      assets.zeldAssets,
      assets.korAssets,
      assets.kontorNfts,
      assets.ordinals,
    ],
  );

  // Result-step view. The workflow's `transactions` list is the source of truth for
  // what actually hit the chain: an `"asset"` tx (counterparty attach / zeld
  // transfer / Kontor attach reveal) and/or a standalone `"fee"` payment. We link
  // every one; an empty list means the listing reused an existing UTXO and
  // broadcast nothing (e.g. an already-attached balance with the fee waived by a
  // credit) — it's live immediately with nothing to track. The listing is only
  // "pending confirmation" while a freshly broadcast asset tx is unconfirmed; a
  // fee-only tx doesn't gate the listing (its asset UTXO already exists). This
  // avoids keying off `swap.funded`, which can arrive falsy-but-not-strictly-false.
  const successResult =
    sellOrder.status === "success" ? sellOrder.result : null;
  const transactions = successResult?.transactions ?? [];
  const hasAssetTx = transactions.some((t) => t.kind === "asset");
  const pendingConfirmation = Boolean(successResult?.created) && hasAssetTx;
  // Drop any tx we can't build a URL for, then label: one tx keeps the familiar
  // generic copy; two (attach + fee) name each so they're distinguishable.
  const linked = transactions.flatMap((t) => {
    const url = mempoolTxUrl(network, kontorNetwork, t.txid);
    return url ? [{ url, kind: t.kind }] : [];
  });
  const trackTxs: SellTrackTx[] = linked.map(({ url, kind }) => ({
    url,
    label:
      linked.length > 1
        ? kind === "fee"
          ? "Track the fee payment →"
          : "Track the attach transaction →"
        : "Track it on mempool.space →",
  }));
  const resultView: SellResultView = {
    pendingConfirmation,
    trackTxs,
    successMessage: successResult
      ? !successResult.created
        ? "Listing already exists (no changes)."
        : hasAssetTx
          ? "Sell order submitted!"
          : "Your listing is live!"
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
    assetGroups,
    resultView,
  };
}
