import { StyleSheet } from "react-native";
import { SwapList } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../lib/web3auth.js";
import { Footer } from "../components/Footer.js";

// The market: the SDK's SwapList. Rendered inside the provider set up by _layout.
// The Footer rides at the end of the list's scroll (footerSlot) so it's only seen
// once the user scrolls to the bottom, instead of staying pinned to the screen.
export default function MarketScreen() {
  return (
    <SwapList
      getPrivateKey={getPrivateKey}
      scrollable
      style={styles.list}
      footerSlot={<Footer />}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
