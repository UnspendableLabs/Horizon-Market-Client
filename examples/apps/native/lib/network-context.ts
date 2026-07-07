import { createContext, useContext } from "react";
import type { UiNetwork } from "./networks.js";

/**
 * The active UI network + its setter, provided by the root layout ABOVE the
 * <HorizonMarketProvider> (so it survives the provider's key={network} remount)
 * and read by the Footer — which now renders inside each screen's scroll, so it
 * can no longer receive these as props from the layout.
 */
export interface NetworkContextValue {
  network: UiNetwork;
  setNetwork: (network: UiNetwork) => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export const NetworkProvider = NetworkContext.Provider;

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return ctx;
}
