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
      <main style={{ flex: 1 }}>
        <SwapList
          getPrivateKey={getPrivateKey}
          classNames={{
            // Keeps the filter bar pinned just below the sticky header (70px).
            // The background matches the body so content scrolls behind it cleanly.
            toolbar: "sticky top-[70px] z-40 bg-[#0b0b15]",
          }}
        />
      </main>
    </HorizonMarketProvider>
  );
}
