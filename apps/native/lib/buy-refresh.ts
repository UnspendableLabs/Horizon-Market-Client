import { createContext, useContext } from "react";

/**
 * A cross-tab "refresh the Buy list" signal. Bumped by the Sell tab when an
 * order is successfully created (validated), and read by the Buy tab, which keys
 * its <SwapList> by {@link nonce} so the feed — and the connected wallet's
 * pending orders — refetch, surfacing the just-created order at the top. Provided
 * by the tabs layout ABOVE the <Tabs> navigator so both screens share it.
 */
export interface BuyRefreshValue {
  /** Bumps on every {@link requestBuyRefresh}. */
  nonce: number;
  /** Ask the Buy tab to refetch its list (e.g. after opening a sell order). */
  requestBuyRefresh: () => void;
}

const BuyRefreshContext = createContext<BuyRefreshValue | null>(null);

export const BuyRefreshProvider = BuyRefreshContext.Provider;

export function useBuyRefresh(): BuyRefreshValue {
  const ctx = useContext(BuyRefreshContext);
  if (!ctx) {
    throw new Error("useBuyRefresh must be used within a BuyRefreshProvider");
  }
  return ctx;
}
