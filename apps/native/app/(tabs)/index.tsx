import { StyleSheet, Text } from "react-native";
import { SwapList } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../../lib/web3auth.js";
import { useBuyRefresh } from "../../lib/buy-refresh.js";
import { colors, fonts } from "../../lib/theme.js";
import {
  trackBuyCompleted,
  trackBuyFailed,
  trackBuyLoginRequired,
  trackBuyStarted,
  trackDelistCompleted,
  trackDelistFailed,
  trackDelistStarted,
} from "../../lib/analytics/events.js";

// Buy tab: the SDK's SwapList (the atomic-swap marketplace). Fills the space
// between the top safe area and the fixed tab bar; the list scrolls on its own.
// A "Buy" heading (same style as the other tabs) + an "Updated …" label (whose
// age ticks on its own) and a right-pinned Refresh ride above the toolbar. The
// list re-fetches ONLY on Refresh or a filter/sort change — never automatically.
export default function BuyScreen() {
  // Remount (fresh fetch of the feed + the wallet's pending orders) whenever a
  // sell order is created, so the new pending order appears at the top of the
  // list. The nonce only bumps on a successful sell — normal tab switches keep
  // the list's state — so this doesn't reintroduce refetch-on-focus.
  const { nonce } = useBuyRefresh();
  return (
    <SwapList
      key={nonce}
      getPrivateKey={getPrivateKey}
      title={<Text style={styles.title}>Buy</Text>}
      scrollable
      style={styles.list}
      onLoginRequired={trackBuyLoginRequired}
      onBuyStarted={trackBuyStarted}
      onDelistStarted={trackDelistStarted}
      onBuySuccess={trackBuyCompleted}
      onBuyError={trackBuyFailed}
      onDelistSuccess={trackDelistCompleted}
      onDelistError={trackDelistFailed}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    // <SwapList>'s root is transparent. Under the old bottom-tabs the navigator's
    // per-scene `sceneStyle` tinted it; the swipeable pager (react-native-pager-view)
    // instead paints an opaque white background behind transparent scenes on
    // Android, so tint the Buy scene itself — the way the other three tabs already
    // set their own background.
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
});
