import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts, Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { HorizonMarketProvider, useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { Header } from "../components/Header.js";
import { getPrivateKey } from "../lib/web3auth.js";
import { colors, HORIZON_THEME } from "../lib/theme.js";
import { NetworkProvider } from "../lib/network-context.js";
import {
  NETWORKS,
  getInitialNetwork,
  loadPersistedNetwork,
  persistNetwork,
  type UiNetwork,
} from "../lib/networks.js";

// Keep the native splash up until fonts settle (or fail), so the market doesn't
// flash unstyled text first.
void SplashScreen.preventAutoHideAsync();

/**
 * Restores an existing Web3Auth session on startup — and re-derives addresses for
 * the newly selected network after the provider remounts on a network switch (the
 * remount resets authState, so this re-probes the persisted key). Mirrors the web
 * app's SessionRestorer.
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

export default function RootLayout() {
  const router = useRouter();

  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  // Network is chosen at runtime via the footer toggle. Switching remounts the
  // provider (key={network}) so SessionRestorer re-derives addresses for the newly
  // selected network. The Footer sits OUTSIDE the provider so it survives the remount.
  const [network, setNetwork] = useState<UiNetwork>(getInitialNetwork);
  const userPicked = useRef(false);

  // Hydrate the persisted network once on mount (AsyncStorage is async).
  useEffect(() => {
    let active = true;
    loadPersistedNetwork().then((stored) => {
      if (active && !userPicked.current && stored) setNetwork(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  const handleNetworkChange = (next: UiNetwork) => {
    userPicked.current = true;
    void persistNetwork(next);
    setNetwork(next);
  };

  if (!fontsLoaded && !fontError) return null;

  // `sdkNetwork` is the SDK network ("mainnet" | "testnet"); `providerConfig` carries
  // the remaining provider props (on signet: kontorNetwork + signet URLs). `label` is
  // UI-only, so it's dropped here.
  const { sdkNetwork, label: _label, ...providerConfig } = NETWORKS[network];
  void _label;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" backgroundColor={colors.background} />

        {/* NetworkProvider sits OUTSIDE the HorizonMarketProvider so it survives
            the provider's key={network} remount. Each screen now renders the
            Footer at the bottom of its own scroll (so it's only seen when
            scrolled to the end) and reads the network from this context. */}
        <NetworkProvider value={{ network, setNetwork: handleNetworkChange }}>
          <View style={styles.content}>
            <HorizonMarketProvider
              key={network}
              network={sdkNetwork}
              {...providerConfig}
              theme={HORIZON_THEME}
            >
              <SessionRestorer />
              <Header onOpenWallet={() => router.push("/wallet")} />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              />
            </HorizonMarketProvider>
          </View>
        </NetworkProvider>
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
});
