import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts, Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { HorizonMarketProvider, useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { AppLockProvider, AppLockBridge, useAppLockBoot } from "../components/AppLock.js";
import { PrivacyScreen } from "../components/PrivacyScreen.js";
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
  const reportNoSession = useAppLockBoot();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || addresses) return;
    ranRef.current = true;
    getPrivateKey("")
      .then((key) => {
        // A found key lands as `addresses` → the app-lock cover hands off to the
        // lock. No key means there's no session to restore (none cached, expired,
        // or the auth prompt was declined) — lift the cover so the market shows
        // instead of hanging on it forever.
        if (key) initialize(key);
        else reportNoSession();
      })
      .catch((err) => {
        console.error("Web3Auth session restore failed:", err);
        reportNoSession();
      });
  }, [initialize, addresses, reportNoSession]);

  return null;
}

export default function RootLayout() {
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
      {/* The bottom edge is left to the tab bar (it pads for the home indicator
          itself), so its background reaches the screen edge instead of floating
          above a safe-area gap. */}
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <StatusBar style="light" backgroundColor={colors.background} />

        {/* NetworkProvider + AppLockProvider both sit OUTSIDE the
            HorizonMarketProvider so they survive the provider's key={network}
            remount. AppLockProvider holds the biometric-lock state (raising it on
            a network switch would force a spurious re-auth); <AppLockBridge/>
            inside the provider reports wallet presence back up to it, and the lock
            overlay it renders covers the whole app — tab bar included. The
            network switch now lives on the Settings tab, which reads/writes this
            provider via useNetwork(). */}
        <NetworkProvider value={{ network, setNetwork: handleNetworkChange }}>
          <AppLockProvider>
            <View style={styles.content}>
              <HorizonMarketProvider
                key={network}
                network={sdkNetwork}
                {...providerConfig}
                theme={HORIZON_THEME}
              >
                <SessionRestorer />
                <AppLockBridge />
                {/* Root stack: the (tabs) group (Buy/Sell/Wallet/Settings, each
                    with the fixed bottom tab bar) plus the /auth deep-link sink. */}
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.background },
                  }}
                />
              </HorizonMarketProvider>
            </View>
          </AppLockProvider>
        </NetworkProvider>

        {/* Above everything: an opaque brand cover shown whenever the app leaves
            the foreground, so the OS app-switcher snapshot can't leak balances. */}
        <PrivacyScreen />
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
