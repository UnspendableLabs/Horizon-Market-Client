/**
 * Per-domain analytics wrappers, mirroring the web app's split
 * (`buy-analytics.ts` / `sell-analytics.ts` / `mywallet-client.tsx`'s inline
 * tracking). Every event is stamped with `platform: "native"` and a `surface`
 * so it's filterable in Usermaven without colliding with the web app's own
 * `buy_page` / `sell_page` / `wallet_page` surfaces, while reusing the SAME
 * event names where the underlying moment matches 1:1 — so dashboards built
 * against the web funnel keep working for mobile.
 */
import type { AtomicSwap } from "@unspendablelabs/horizon-market-client";
import { track, type EventPayload } from "./usermaven-client.js";

export const SURFACE = {
  buy: "buy_native",
  sell: "sell_native",
  wallet: "wallet_native",
  settings: "settings_native",
} as const;

function withPlatform(surface: string, props?: EventPayload): EventPayload {
  return { platform: "native", surface, ...props };
}

function isKontorSwap(swap: AtomicSwap): boolean {
  return swap.listingType === "kontor";
}

function swapEventProps(swap: AtomicSwap): EventPayload {
  return {
    swap_id: swap.id,
    asset: swap.assetLongname ?? swap.assetName,
    listing_type: swap.listingType,
    quantity: swap.assetQuantity?.toString(),
  };
}

// ---- Wallet ---------------------------------------------------------------

export function trackWalletConnected(wallet: "web3auth" | "mnemonic"): void {
  void track("wallet_connected", withPlatform(SURFACE.wallet, { wallet }));
}

export function trackWalletDisconnectClicked(): void {
  void track("wallet_disconnect_clicked", withPlatform(SURFACE.wallet));
}

export function trackWalletDepositOpened(props: {
  symbol: string;
  depositType: string;
  assetType?: string;
}): void {
  void track(
    "wallet_deposit_opened",
    withPlatform(SURFACE.wallet, {
      symbol: props.symbol,
      deposit_type: props.depositType,
      asset_type: props.assetType,
    }),
  );
}

export function trackWalletWithdrawOpened(targetType: string): void {
  void track(
    "wallet_withdraw_opened",
    withPlatform(SURFACE.wallet, { target_type: targetType }),
  );
}

export function trackWalletWithdrawCompleted(
  targetType: string,
  txid: string,
): void {
  void track(
    "wallet_withdraw_completed",
    withPlatform(SURFACE.wallet, { target_type: targetType, txid }),
  );
}

export function trackWalletSellAssetClicked(assetType: string): void {
  void track(
    "wallet_sell_asset_clicked",
    withPlatform(SURFACE.wallet, { asset_type: assetType }),
  );
}

// ---- Buy / delist -----------------------------------------------------

export function trackBuyLoginRequired(swap: AtomicSwap): void {
  void track(
    "swap_multi_buy_preview_connect_clicked",
    withPlatform(SURFACE.buy, swapEventProps(swap)),
  );
}

export function trackBuyStarted(swap: AtomicSwap): void {
  const event = isKontorSwap(swap)
    ? "swap_kontor_buy_button_clicked"
    : "swap_multi_buy_button_clicked";
  void track(event, withPlatform(SURFACE.buy, swapEventProps(swap)));
}

export function trackBuyCompleted(swap: AtomicSwap): void {
  const event = isKontorSwap(swap)
    ? "swap_kontor_buy_completed"
    : "swap_multi_buy_sign_completed";
  void track(event, withPlatform(SURFACE.buy, swapEventProps(swap)));
}

export function trackBuyFailed(swap: AtomicSwap, error: Error): void {
  const event = isKontorSwap(swap)
    ? "swap_kontor_buy_failed"
    : "swap_multi_buy_sign_failed";
  void track(
    event,
    withPlatform(SURFACE.buy, { ...swapEventProps(swap), error: error.message }),
  );
}

export function trackDelistStarted(swap: AtomicSwap): void {
  void track("delist_clicked", withPlatform(SURFACE.buy, swapEventProps(swap)));
}

export function trackDelistCompleted(swap: AtomicSwap): void {
  void track(
    "delist_completed",
    withPlatform(SURFACE.buy, swapEventProps(swap)),
  );
}

export function trackDelistFailed(swap: AtomicSwap, error: Error): void {
  void track(
    "delist_failed",
    withPlatform(SURFACE.buy, { ...swapEventProps(swap), error: error.message }),
  );
}

// ---- Sell ---------------------------------------------------------------

export function trackListingFormSuccess(props: {
  id: string;
  listingType: string;
  assetName: string | null;
  inscriptionNumber?: number | null;
  created: boolean;
}): void {
  void track(
    "listing_flow_swap_form_success",
    withPlatform(SURFACE.sell, props),
  );
}

export function trackListingFormFailed(error: Error): void {
  void track(
    "listing_flow_swap_form_failed",
    withPlatform(SURFACE.sell, { error: error.message }),
  );
}

// ---- Settings -------------------------------------------------------------

export function trackNetworkSwitched(from: string, to: string): void {
  void track(
    "network_switched",
    withPlatform(SURFACE.settings, { from, to }),
  );
}

// ---- Screen views -----------------------------------------------------

export function trackScreenView(path: string): void {
  void track("pageview", { path }, path);
}
