import { Tabs } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { AssetOption } from "@unspendablelabs/horizon-market-client/react";
import { TabBar } from "../../components/TabBar.js";
import { colors } from "../../lib/theme.js";
import { SellIntentProvider, type SellIntentValue } from "../../lib/sell-intent.js";

/**
 * The app's main tab group: Buy · Sell · Wallet · Settings.
 *
 * Renders a classic fixed bottom tab bar (the custom {@link TabBar}) instead of
 * the old header + modals. Each tab keeps its own state while the others stay
 * mounted (the standard bottom-tabs behaviour), so switching between browsing
 * the market and the wallet doesn't reset scroll/filters.
 *
 * Order here === order in the tab bar: index (Buy), sell, wallet, settings.
 *
 * Also hosts the {@link SellIntentProvider}: the Wallet tab's per-balance "Sell"
 * action stashes the asset here and switches to the Sell tab, which reads it and
 * opens its detail step for that asset (see lib/sell-intent).
 */
export default function TabsLayout() {
  const [pendingAsset, setPendingAsset] = useState<AssetOption | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestSell = useCallback((asset: AssetOption) => {
    setPendingAsset(asset);
    setNonce((n) => n + 1);
  }, []);
  const clear = useCallback(() => setPendingAsset(null), []);
  const sellIntent = useMemo<SellIntentValue>(
    () => ({ pendingAsset, nonce, requestSell, clear }),
    [pendingAsset, nonce, requestSell, clear],
  );

  return (
    <SellIntentProvider value={sellIntent}>
      <Tabs
        // Bottom-tabs paints each scene with react-navigation's default (white)
        // background; the Buy tab's <SwapList> root is transparent, so without this
        // the market showed through as white. sceneStyle tints every tab's scene
        // with the brand background.
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
        }}
        tabBar={(props) => <TabBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: "Buy" }} />
        <Tabs.Screen name="sell" options={{ title: "Sell" }} />
        <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
    </SellIntentProvider>
  );
}
