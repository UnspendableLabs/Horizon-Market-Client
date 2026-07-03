import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import {
  useHorizonMarket,
  WalletBalances,
} from "@unspendablelabs/horizon-market-client/react";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

interface WalletScreenProps {
  onBack: () => void;
}

/**
 * Standalone "Wallet" view (native counterpart of the web app's WalletPage):
 * the full balances list — BTC large, the XCP / KOR / ZELD headline tokens, then
 * every other holding — reached from the header wallet menu's "Open wallet".
 * Renders the SDK <WalletBalances/>, which inherits the provider's theme.
 */
export function WalletScreen({ onBack }: WalletScreenProps) {
  const { addresses } = useHorizonMarket();

  // Back button + "Wallet" heading. When connected it's handed to
  // <WalletBalances> so it shares the header row with "Updated …" + Refresh.
  const heading = (
    <View style={styles.headingRow}>
      <Pressable
        onPress={onBack}
        style={styles.backButton}
        accessibilityLabel="Back to marketplace"
      >
        <Text style={styles.backGlyph}>‹</Text>
      </Pressable>
      <Text style={styles.title}>Wallet</Text>
    </View>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {addresses ? (
        <WalletBalances title={heading} />
      ) : (
        <>
          {heading}
          <Text style={styles.prompt}>
            Connect your wallet to view your balances.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  backGlyph: {
    fontSize: 26,
    lineHeight: 28,
    color: colors.foreground,
    marginTop: -2,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  prompt: {
    color: colors.muted,
    fontFamily: fonts.sans,
  },
});
