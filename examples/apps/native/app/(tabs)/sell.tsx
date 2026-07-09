import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  SellOrderForm,
  useHorizonMarket,
} from "@unspendablelabs/horizon-market-client/react";
import { ConnectPrompt } from "../../components/ConnectPrompt.js";
import { colors, fonts, spacing } from "../../lib/theme.js";

/**
 * Sell tab: the SDK's <SellOrderForm/> promoted from a modal to a full screen.
 * The form drives its own form → review → progress → result flow inline. When no
 * wallet is connected it falls back to the login gate.
 */
export default function SellScreen() {
  const { addresses } = useHorizonMarket();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Sell</Text>
      {addresses ? (
        <View style={styles.card}>
          <SellOrderForm />
        </View>
      ) : (
        <ConnectPrompt message="Connect your wallet to list an asset for sale." />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  // A subtle elevated surface so the form reads as a card, matching the modal it
  // replaces.
  card: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 18,
    padding: spacing.md,
  },
});
