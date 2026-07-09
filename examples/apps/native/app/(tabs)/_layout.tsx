import { Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar.js";
import { colors } from "../../lib/theme.js";

/**
 * The app's main tab group: Buy · Sell · Wallet · Settings.
 *
 * Renders a classic fixed bottom tab bar (the custom {@link TabBar}) instead of
 * the old header + modals. Each tab keeps its own state while the others stay
 * mounted (the standard bottom-tabs behaviour), so switching between browsing
 * the market and the wallet doesn't reset scroll/filters.
 *
 * Order here === order in the tab bar: index (Buy), sell, wallet, settings.
 */
export default function TabsLayout() {
  return (
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
  );
}
