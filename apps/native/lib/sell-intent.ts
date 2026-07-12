import { createContext, useContext } from "react";
import type { AssetOption } from "@unspendablelabs/horizon-market-client/react";

/**
 * A cross-tab "sell this asset" request. Set from the Wallet tab (the per-balance
 * Sell action) and read by the Sell tab, which opens its detail step for the
 * pending asset — so tapping Sell in the wallet lands on exactly the same screen
 * as step 2 of the Sell tab, rather than a modal. Provided by the tabs layout
 * ABOVE the <Tabs> navigator so both screens share it.
 */
export interface SellIntentValue {
  /** Asset the user asked to sell from elsewhere (e.g. the wallet), or null. */
  pendingAsset: AssetOption | null;
  /**
   * Bumps on every {@link requestSell}. Key the Sell screen by it so a fresh
   * request (even for the same asset) remounts the form onto its detail step.
   */
  nonce: number;
  /** Ask the Sell tab to open `asset` at its detail step. */
  requestSell: (asset: AssetOption) => void;
  /** Clear the pending request (e.g. once the Sell tab is left). */
  clear: () => void;
}

const SellIntentContext = createContext<SellIntentValue | null>(null);

export const SellIntentProvider = SellIntentContext.Provider;

export function useSellIntent(): SellIntentValue {
  const ctx = useContext(SellIntentContext);
  if (!ctx) {
    throw new Error("useSellIntent must be used within a SellIntentProvider");
  }
  return ctx;
}
