import { HorizonMarketProvider, SwapList } from "@unspendablelabs/horizon-market-client/react";
import { Header } from "./components/Header.js";
import { getPrivateKey } from "./lib/web3auth.js";

const HORIZON_THEME = {
  colors: {
    primary: "#1ee7c5",
    primaryForeground: "#0b0b15",
    background: "#0b0b15",
    surface: "rgba(254, 251, 249, 0.04)",
    border: "rgba(254, 251, 249, 0.16)",
    text: "#fefbf9",
    textMuted: "rgba(254, 251, 249, 0.33)",
    success: "#1ee7c5",
    error: "#f87171",
    pending: "#fbbf24",
  },
  typography: {
    fontFamily: "'Montserrat', system-ui, sans-serif",
  },
  radii: {
    sm: 8,
    md: 12,
    lg: 18,
  },
} as const;

export default function App() {
  return (
    <HorizonMarketProvider
      network="mainnet"
      baseUrl={import.meta.env.VITE_HORIZON_MARKET_URL}
      theme={HORIZON_THEME}
    >
      <Header />
      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: "var(--content-max-width)",
          margin: "0 auto",
          // No top padding: the 24px gap below the header lives inside the
          // sticky toolbar (pt-6) instead, so the toolbar never shifts up when
          // it pins — it rests exactly where it sticks.
          padding: "0 24px 64px",
        }}
      >
        <SwapList
          getPrivateKey={getPrivateKey}
          classNames={{
            // Pins the filter bar at the header's bottom edge
            // (--header-height, see globals.css).
            // pt-6/pb-6 (24px) hold the gaps above and below the filters
            // *inside* the sticky box, so the bar stays at its initial position
            // instead of jumping up against the header, and its background
            // covers content scrolling behind it cleanly on both edges.
            // toolbar-fullbleed makes the background span the full viewport
            // width (past main's centered max-width) while keeping the filters
            // aligned with the content column — see globals.css.
            toolbar:
              "sticky top-[var(--header-height)] z-40 bg-[#0b0b15] pt-6 pb-6 toolbar-fullbleed",
          }}
        />
      </main>
    </HorizonMarketProvider>
  );
}
