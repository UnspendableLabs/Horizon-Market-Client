import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LoginPanel } from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey } from "../lib/web3auth.js";
import { RestoreWalletForm, NewWalletForm } from "./MnemonicConnect.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import { trackWalletConnected } from "../lib/analytics/events.js";

interface ConnectPromptProps {
  /** One-line reason shown above the login form (e.g. "…to list an asset"). */
  message: string;
}

type Screen = "menu" | "restore" | "create";

/**
 * Login gate shown on the Sell / Wallet tabs when no wallet is connected. Offers
 * three ways in — Web3Auth email (the SDK's <LoginPanel/>), restoring a 12-word
 * recovery phrase, or generating a new HD wallet. All three land in the same
 * connected state: on success the provider's `addresses` update and the host
 * screen re-renders. This is the app's primary sign-in entry point.
 */
export function ConnectPrompt({ message }: ConnectPromptProps) {
  const [screen, setScreen] = useState<Screen>("menu");

  if (screen === "restore") {
    return <RestoreWalletForm onBack={() => setScreen("menu")} />;
  }
  if (screen === "create") {
    return <NewWalletForm onBack={() => setScreen("menu")} />;
  }

  return (
    <View style={styles.root}>
      <Text style={styles.message}>{message}</Text>
      {/* autoDetectSession is off: SessionRestorer already probes for a persisted
          session at boot, so this form only handles an explicit sign-in. */}
      <LoginPanel
        getPrivateKey={getPrivateKey}
        autoDetectSession={false}
        onSuccess={() => trackWalletConnected("web3auth")}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable
        onPress={() => setScreen("restore")}
        style={styles.altButton}
        accessibilityRole="button"
      >
        <Text style={styles.altButtonText}>Restore wallet</Text>
        <Text style={styles.altButtonSub}>Enter a 12-word recovery phrase</Text>
      </Pressable>

      <Pressable
        onPress={() => setScreen("create")}
        style={styles.altButton}
        accessibilityRole="button"
      >
        <Text style={styles.altButtonText}>New HD wallet</Text>
        <Text style={styles.altButtonSub}>Generate a fresh 12-word phrase</Text>
      </Pressable>
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
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  altButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  altButtonText: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  altButtonSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
});
