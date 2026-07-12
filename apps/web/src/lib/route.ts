import { useEffect, useState } from "react";

/**
 * Minimal hash-based routing — this example has no router dependency, so the
 * "Wallet" page is reached via `#/wallet` and everything else falls back to the
 * marketplace. Kept tiny on purpose: a single string route, no params.
 */
export type Route = "market" | "wallet";

function readRoute(): Route {
  return window.location.hash.replace(/^#\/?/, "") === "wallet"
    ? "wallet"
    : "market";
}

/** Current route, kept in sync with back/forward and `location.hash` changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function goToWallet(): void {
  window.location.hash = "#/wallet";
}

export function goToMarket(): void {
  // Clearing the hash (rather than setting "#/") keeps the URL clean and still
  // fires `hashchange` when navigating away from #/wallet.
  if (window.location.hash) {
    history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}
