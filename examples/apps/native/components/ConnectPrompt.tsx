import { StyleSheet, Text, View } from "react-native";
import { LoginPanel } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../lib/web3auth.js";
import { colors, fonts, spacing } from "../lib/theme.js";

interface ConnectPromptProps {
  /** One-line reason shown above the login form (e.g. "…to list an asset"). */
  message: string;
}

/**
 * Login gate shown on the Sell / Wallet tabs when no wallet is connected. Wraps
 * the SDK's <LoginPanel/>; on success the provider's `addresses` update and the
 * host screen re-renders into its connected state. This is now the app's primary
 * sign-in entry point (the old header "Sell"/wallet modals are gone).
 */
export function ConnectPrompt({ message }: ConnectPromptProps) {
  return (
    <View style={styles.root}>
      <Text style={styles.message}>{message}</Text>
      {/* autoDetectSession is off: SessionRestorer already probes for a persisted
          session at boot, so this form only handles an explicit sign-in. */}
      <LoginPanel getPrivateKey={getPrivateKey} autoDetectSession={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  message: {
    fontSize: 14,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
});
