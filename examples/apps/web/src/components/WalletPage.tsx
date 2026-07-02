import { ArrowLeft } from "lucide-react";
import {
  useHorizonMarket,
  WalletBalances,
} from "@unspendablelabs/horizon-market-client/react";
import { goToMarket } from "../lib/route.js";

/**
 * Standalone "Wallet" view: the full balances list (BTC shown large, then the
 * XCP / KOR / ZELD headline tokens, then every other holding). Reached from the
 * header wallet menu's "Show all". Lives inside <main>, so it inherits the
 * provider's theme vars and the SDK <WalletBalances> renders themed.
 */
export function WalletPage() {
  const { addresses } = useHorizonMarket();

  // Back button + "Wallet" heading. When connected, this is handed to
  // <WalletBalances> so it shares the header row with "Updated …" + Refresh;
  // otherwise it's rendered standalone above the connect prompt.
  const heading = (
    <div className="flex items-center gap-3">
      <button
        onClick={goToMarket}
        className="p-2.5 rounded-lg transition-colors"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-foreground)",
        }}
        aria-label="Back to marketplace"
      >
        <ArrowLeft size={18} />
      </button>
      <h1
        className="text-2xl font-semibold"
        style={{ color: "var(--color-foreground)" }}
      >
        Wallet
      </h1>
    </div>
  );

  return (
    <div style={{ paddingTop: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      {addresses ? (
        <WalletBalances title={heading} />
      ) : (
        <>
          {heading}
          <p style={{ color: "var(--color-muted)" }}>
            Connect your wallet to view your balances.
          </p>
        </>
      )}
    </div>
  );
}
