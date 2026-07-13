import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import type { MaterialTopTabBarProps } from "@react-navigation/material-top-tabs";
import type { AssetOption } from "@unspendablelabs/horizon-market-client/react";
import { SwipeTabs } from "../../components/SwipeTabs.js";
import { TabBar } from "../../components/TabBar.js";
import { colors } from "../../lib/theme.js";
import { SellIntentProvider, type SellIntentValue } from "../../lib/sell-intent.js";

/**
 * The app's main tab group: Buy · Sell · Wallet · Settings.
 *
 * Renders a classic fixed bottom tab bar (the custom {@link TabBar}) — but the
 * scenes now live in a swipeable pager ({@link SwipeTabs}, Material top-tabs pinned
 * to the bottom), so the four tabs can be changed by swiping left/right as well as
 * tapping. Each tab keeps its own state while the others stay mounted (top-tabs are
 * non-lazy by default, matching the old bottom-tabs behaviour), so switching
 * between browsing the market and the wallet doesn't reset scroll/filters.
 *
 * Order here === order in the tab bar AND swipe order: index (Buy), sell, wallet,
 * settings.
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
      <SwipeTabs
        // Pin the tab bar to the bottom and render our custom one, so the pager
        // keeps the classic bottom-tab look while swiping horizontally between
        // scenes.
        tabBarPosition="bottom"
        tabBar={(props: MaterialTopTabBarProps) => <TabBar {...props} />}
        // The pager paints its container with react-navigation's default (white)
        // background behind each scene; the Buy tab's <SwapList> root is
        // transparent, so without this the market showed through as white. Tint the
        // whole navigator with the brand background instead. (Material top-tabs has
        // no per-scene sceneStyle like bottom-tabs did — the container style covers
        // every page.)
        style={{ backgroundColor: colors.background }}
        screenOptions={{
          // swipeEnabled is the default; stated explicitly because the swipe
          // gesture is the whole point of using this navigator.
          swipeEnabled: true,
          // Crucial for perf. The old bottom-tabs navigator detached + FROZE
          // inactive screens (react-native-screens `freezeOnBlur`), so only the
          // focused tab did any work. The pager keeps every mounted page live, so
          // without `lazy` all four screens — the market list's self-ticking
          // "Updated …" timer, the wallet's balance queries, etc. — run at once and
          // peg the CPU (constant Android ANRs on the emulator). `lazy` defers a
          // tab's first mount until it's actually visited; once mounted it stays
          // mounted (state preserved), so on a fresh launch only the Buy tab is
          // live, matching the old behaviour.
          lazy: true,
          // Shown while a lazy tab mounts on first swipe/tap — a brand-tinted view
          // so the pager's white background never flashes through.
          lazyPlaceholder: () => (
            <View style={{ flex: 1, backgroundColor: colors.background }} />
          ),
        }}
      >
        <SwipeTabs.Screen name="index" options={{ title: "Buy" }} />
        <SwipeTabs.Screen name="sell" options={{ title: "Sell" }} />
        <SwipeTabs.Screen name="wallet" options={{ title: "Wallet" }} />
        <SwipeTabs.Screen name="settings" options={{ title: "Settings" }} />
      </SwipeTabs>
    </SellIntentProvider>
  );
}
