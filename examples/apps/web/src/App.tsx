import { HorizonMarketProvider, SwapList, useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { useEffect, useRef, useState } from "react";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { WalletPage } from "./components/WalletPage.js";
import { useRoute } from "./lib/route.js";
import { getPrivateKey } from "./lib/web3auth.js";
import {
  NETWORKS,
  getInitialNetwork,
  persistNetwork,
  type UiNetwork,
} from "./lib/networks.js";

/**
 * Restores an existing Web3Auth session on app startup — crucially after the
 * email-passwordless *redirect* returns to the app (URL ends in `#b64Params=…`).
 * The login modals (Header / SwapList) only mount their session probe while
 * open, so without this the returning session would never be picked up and
 * nothing would happen after entering the OTP code.
 */
function SessionRestorer() {
  const { initialize, addresses } = useHorizonMarket();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || addresses) return;
    ranRef.current = true;
    getPrivateKey("")
      .then((key) => {
        if (key) initialize(key);
      })
      .catch((err) => console.error("Web3Auth session restore failed:", err));
  }, [initialize, addresses]);

  return null;
}

const HORIZON_THEME = {
  colors: {
    primary: "#1ee7c5",
    primaryForeground: "#0b0b15",
    background: "#0b0b15",
    // Lighter stop of the modal's diagonal gradient (matches the brand
    // `.bgradient-box`: linear-gradient(224deg, #0b0b15, #161624)).
    backgroundElevated: "#161624",
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
  // Network is chosen at runtime via the footer toggle. Switching remounts the
  // provider (key={network}) so SessionRestorer re-derives addresses for the
  // newly selected network from the same Web3Auth key.
  const [network, setNetwork] = useState<UiNetwork>(getInitialNetwork);
  const route = useRoute();

  const handleNetworkChange = (next: UiNetwork) => {
    persistNetwork(next);
    setNetwork(next);
  };

  // `sdkNetwork` is the SDK network ("mainnet" | "testnet"); `providerConfig`
  // carries the remaining provider props (on signet: kontorNetwork +
  // signet-specific URLs). `label` is UI-only, so it's dropped here.
  const { sdkNetwork, label: _label, ...providerConfig } = NETWORKS[network];
  void _label;

  return (
    <>
      <HorizonMarketProvider
        key={network}
        network={sdkNetwork}
        // providerConfig carries the per-network API config (Horizon, ord,
        // Counterparty, ZELD, Kontor). Mainnet falls back to the SDK's public
        // defaults; signet uses the *_SIGNET values from .env.local.
        {...providerConfig}
        theme={HORIZON_THEME}
      >
        <SessionRestorer />
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
          {route === "wallet" ? (
            <WalletPage />
          ) : (
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
          )}
        </main>
      </HorizonMarketProvider>

      {/* Footer lives outside the provider so it survives the key={network}
          remount and can drive the switch. */}
      <Footer network={network} onChange={handleNetworkChange} />
    </>
  );
}
