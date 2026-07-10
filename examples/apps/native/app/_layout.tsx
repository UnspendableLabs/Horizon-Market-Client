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
import { restoreMnemonicSession } from "../lib/mnemonic-session.js";
import { colors, HORIZON_THEME } from "../lib/theme.js";
import { NetworkProvider } from "../lib/network-context.js";
import {
  NETWORKS,
  getInitialNetwork,
  loadPersistedNetwork,
  persistNetwork,
  type UiNetwork,
} from "../lib/networks.js";
import {
  getInitialDerivationMode,
  loadPersistedDerivationMode,
  persistDerivationMode,
} from "../lib/derivation.js";
import type { DerivationMode } from "@unspendablelabs/horizon-market-client/react";

// Keep the native splash up until fonts settle (or fail), so the market doesn't
// flash unstyled text first.
void SplashScreen.preventAutoHideAsync();

/**
 * Restores an existing session on startup — and re-derives addresses for the newly
 * selected network after the provider remounts on a network switch (the remount
 * resets authState, so this re-probes the persisted credential). Mirrors the web
 * app's SessionRestorer.
 *
 * A session persists EITHER a recovery phrase (Restore / New HD wallet) or a raw
 * Web3Auth key, so try the phrase first and only fall through to the key path when
 * there's none. Both settle into the same connected state.
 */
function SessionRestorer() {
  const { initialize, initializeWithMnemonic, addresses } = useHorizonMarket();
  const reportNoSession = useAppLockBoot();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || addresses) return;
    ranRef.current = true;
    restoreMnemonicSession()
      .then((mnemonic) => {
        if (mnemonic) {
          // A phrase wallet is always Horizon Wallet HD — derive it as such
          // explicitly (the connect flow already persisted horizon-wallet; this
          // just makes the invariant hold regardless of the restored prop).
          initializeWithMnemonic(mnemonic, "horizon-wallet");
          return;
        }
        // No phrase → try the Web3Auth key. A found credential lands as
        // `addresses` → the app-lock cover hands off to the lock. Nothing to
        // restore (none cached, expired, or the auth prompt was declined) → lift
        // the cover so the market shows instead of hanging on it forever.
        return getPrivateKey("").then((key) => {
          if (key) initialize(key);
          else reportNoSession();
        });
      })
      .catch((err) => {
        console.error("Session restore failed:", err);
        reportNoSession();
      });
  }, [initialize, initializeWithMnemonic, addresses, reportNoSession]);

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

  // Address-derivation choice — held here (OUTSIDE the key={network} provider) so
  // it survives the network remount and is fed back in as a controlled prop. The
  // Settings toggle drives it through the SDK context; this handler persists it.
  // Horizon-wallet mode always uses a 12-word phrase (the SDK default), so there's
  // no word-count state to carry.
  const [derivationMode, setDerivationMode] = useState<DerivationMode>(
    getInitialDerivationMode,
  );
  const derivationPicked = useRef(false);

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

  // Hydrate the persisted derivation choice once on mount. If the user toggles
  // before this resolves, `derivationPicked` guards their choice from being
  // clobbered by the stored value.
  useEffect(() => {
    let active = true;
    void loadPersistedDerivationMode().then((stored) => {
      if (active && !derivationPicked.current && stored) setDerivationMode(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleDerivationModeChange = (next: DerivationMode) => {
    derivationPicked.current = true;
    void persistDerivationMode(next);
    setDerivationMode(next);
  };

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
                // Controlled derivation choice — survives the remount and is
                // driven from the Settings tab via the SDK context.
                // (mnemonicWordCount stays at its 12-word default.)
                derivationMode={derivationMode}
                onDerivationModeChange={handleDerivationModeChange}
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
