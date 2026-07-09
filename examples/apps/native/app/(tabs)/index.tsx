import { StyleSheet } from "react-native";
import { SwapList } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../../lib/web3auth.js";

// Buy tab: the SDK's SwapList (the atomic-swap marketplace). Fills the space
// between the top safe area and the fixed tab bar; the list scrolls on its own.
export default function BuyScreen() {
  return <SwapList getPrivateKey={getPrivateKey} scrollable style={styles.list} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
