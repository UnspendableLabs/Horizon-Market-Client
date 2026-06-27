import { NETWORKS, type UiNetwork } from "../lib/networks.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

interface FooterProps {
  network: UiNetwork;
  onChange: (network: UiNetwork) => void;
}

/**
 * Slim sticky bottom bar holding the mainnet ⇄ signet toggle.
 *
 * Lives OUTSIDE <HorizonMarketProvider> (so it survives the provider's
 * `key={network}` remount) and uses only the global theme CSS vars from
 * globals.css, which are available app-wide.
 */
export function Footer({ network, onChange }: FooterProps) {
  return (
    <footer
      className="sticky bottom-0 z-40 flex items-center justify-center gap-3 py-2.5"
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-background)",
      }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-muted)" }}
      >
        Network
      </span>

      <div
        className="flex items-center p-0.5 gap-0.5"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-full)",
        }}
        role="radiogroup"
        aria-label="Bitcoin network"
      >
        {ORDER.map((n) => {
          const active = n === network;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                if (!active) onChange(n);
              }}
              className="px-4 py-1 text-xs font-semibold transition-colors"
              style={{
                borderRadius: "var(--radius-full)",
                background: active ? "var(--color-primary)" : "transparent",
                color: active
                  ? "var(--color-background)"
                  : "var(--color-muted-strong)",
              }}
            >
              {NETWORKS[n].label}
            </button>
          );
        })}
      </div>
    </footer>
  );
}
