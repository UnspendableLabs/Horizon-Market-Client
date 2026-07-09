import { StyleSheet, Text } from "react-native";
import { SwapList } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../../lib/web3auth.js";
import { colors, fonts } from "../../lib/theme.js";

// Buy tab: the SDK's SwapList (the atomic-swap marketplace). Fills the space
// between the top safe area and the fixed tab bar; the list scrolls on its own.
// A "Buy" heading (same style as the other tabs) + an "Updated …" label (whose
// age ticks on its own) and a right-pinned Refresh ride above the toolbar. The
// list re-fetches ONLY on Refresh or a filter/sort change — never automatically.
export default function BuyScreen() {
  return (
    <SwapList
      getPrivateKey={getPrivateKey}
      title={<Text style={styles.title}>Buy</Text>}
      scrollable
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
});
