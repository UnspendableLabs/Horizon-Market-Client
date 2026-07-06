import { StyleSheet } from "react-native";
import { SwapList } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../lib/web3auth.js";

// The market: the SDK's SwapList. Rendered inside the provider set up by _layout.
export default function MarketScreen() {
  return <SwapList getPrivateKey={getPrivateKey} scrollable style={styles.list} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
