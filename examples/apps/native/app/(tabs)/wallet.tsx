import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  useHorizonMarket,
  WalletBalances,
} from "@unspendablelabs/horizon-market-client/react";
import { ConnectPrompt } from "../../components/ConnectPrompt.js";
import { logout as web3authLogout } from "../../lib/web3auth.js";
import { colors, fonts, radii, spacing } from "../../lib/theme.js";

/** Credits (paid + free) — the market's per-listing allowance, surfaced from the
 *  old header dropdown onto the wallet screen. */
function CreditsRow() {
  const { credits, freeCredits, signInError } = useHorizonMarket();
  const loading = credits === null && freeCredits === null;
  const total = (credits ?? 0) + (freeCredits ?? 0);
  return (
    <View style={styles.creditsRow}>
      <Text style={styles.creditsLabel}>Credits</Text>
      {loading && signInError ? (
        <Text style={styles.creditsError} numberOfLines={1}>
          {signInError}
        </Text>
      ) : (
        <Text style={styles.creditsValue}>{loading ? "…" : String(total)}</Text>
      )}
    </View>
  );
}

/**
 * Wallet tab: the full <WalletBalances/> (BTC + tokens + per-asset
 * deposit/withdraw/sell) reached directly — no more header dropdown or "Open
 * wallet" hop. Adds a credits row and a Disconnect action (both previously lived
 * in the header wallet menu). Falls back to the login gate when disconnected.
 */
export default function WalletTab() {
  const { addresses, logout } = useHorizonMarket();

  // Disconnect clears BOTH sessions: the SDK's local state (logout) and the
  // Web3Auth session persisted in secure storage. Update the UI first, then
  // revoke Web3Auth in the background — after a fast cold-start restore Web3Auth
  // was never initialised this session, so awaiting its lazy init would freeze
  // the button for seconds. (Mirrors the old header's handleLogout.)
  const handleDisconnect = () => {
    logout();
    web3authLogout().catch((err) => {
      console.error("Web3Auth logout failed:", err);
    });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {addresses ? (
        <>
          {/* Pass a styled node (not a bare string) so the heading matches the
              other tabs' titles (Sell / Settings) instead of WalletBalances'
              smaller default title size. */}
          <WalletBalances title={<Text style={styles.title}>Wallet</Text>} />
          <CreditsRow />
          <Pressable
            onPress={handleDisconnect}
            style={styles.disconnect}
            accessibilityRole="button"
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>Wallet</Text>
          <ConnectPrompt message="Connect your wallet to view your balances." />
        </>
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
  creditsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  creditsLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  creditsValue: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  creditsError: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.error,
    fontFamily: fonts.sans,
  },
  disconnect: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disconnectText: {
    fontSize: 14,
    color: colors.error,
    fontFamily: fonts.sansSemiBold,
  },
});
