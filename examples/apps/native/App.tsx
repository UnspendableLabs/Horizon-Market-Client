// Polyfills MUST be first — before any bitcoinjs / @web3auth / SDK import — so
// global.Buffer and crypto.getRandomValues exist before key derivation runs.
import "./lib/polyfills.js";

import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts, Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { HorizonMarketProvider, SwapList, useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { getPrivateKey } from "./lib/web3auth.js";
import { colors, HORIZON_THEME } from "./lib/theme.js";
import {
  NETWORKS,
  getInitialNetwork,
  loadPersistedNetwork,
  persistNetwork,
  type UiNetwork,
} from "./lib/networks.js";

/**
 * Restores an existing Web3Auth session on app startup — and re-derives
 * addresses for the newly selected network after the provider remounts on a
 * network switch (the remount resets authState, so this re-probes the persisted
 * Web3Auth key against the new network). Mirrors the web app's SessionRestorer.
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

export default function App() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  // Network is chosen at runtime via the footer toggle. Switching remounts the
  // provider (key={network}) so SessionRestorer re-derives addresses for the
  // newly selected network from the same Web3Auth key.
  const [network, setNetwork] = useState<UiNetwork>(getInitialNetwork);

  // True once the user taps the footer toggle — guards the async hydration below
  // from clobbering a fresh manual choice if AsyncStorage resolves after the tap.
  const userPicked = useRef(false);

  // Hydrate the persisted choice once on mount (AsyncStorage is async, so it
  // can't seed useState synchronously like the web's localStorage).
  useEffect(() => {
    let active = true;
    loadPersistedNetwork().then((stored) => {
      if (active && !userPicked.current && stored) setNetwork(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleNetworkChange = (next: UiNetwork) => {
    userPicked.current = true;
    void persistNetwork(next);
    setNetwork(next);
  };

  if (!fontsLoaded) return null;

  // `sdkNetwork` is the SDK network ("mainnet" | "testnet"); `providerConfig`
  // carries the remaining provider props (on signet: kontorNetwork + signet
  // URLs). `label` is UI-only, so it's dropped here.
  const { sdkNetwork, label: _label, ...providerConfig } = NETWORKS[network];
  void _label;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" backgroundColor={colors.background} />

        {/* The provider remounts on a network switch (key={network}); the
            Footer below sits outside it so it survives the remount. */}
        <View style={styles.content}>
          <HorizonMarketProvider
            key={network}
            network={sdkNetwork}
            {...providerConfig}
            theme={HORIZON_THEME}
          >
            <SessionRestorer />
            <Header />
            <SwapList getPrivateKey={getPrivateKey} scrollable style={styles.list} />
          </HorizonMarketProvider>
        </View>

        <Footer network={network} onChange={handleNetworkChange} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
});
