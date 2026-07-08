/**
 * Privacy screen — an opaque brand cover shown whenever the app is not in the
 * foreground, so the OS app-switcher / multitasking snapshot doesn't leak wallet
 * balances or addresses.
 *
 * The snapshot is captured as the app leaves the foreground, so we cover on any
 * non-"active" AppState ("inactive" and "background"). Rendering on "inactive"
 * (which fires just before "background") gives React a head start to commit the
 * cover before iOS grabs the thumbnail. This is the JS-only approach; on Android
 * a native FLAG_SECURE (expo-screen-capture) would be more airtight but would
 * also block all screenshots, which isn't what we want here.
 *
 * Note: the biometric sheet also drives AppState to "inactive", so this cover
 * shows briefly behind the system prompt — harmless (it's the same brand screen).
 */
import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../lib/theme.js";

export function PrivacyScreen() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setHidden(next !== "active");
    });
    return () => sub.remove();
  }, []);

  if (!hidden) return null;

  return (
    <View style={styles.cover} pointerEvents="none">
      <Text style={styles.wordmark}>Horizon</Text>
      <Text style={styles.tagline}>The DEX of Bitcoin metaprotocols</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  wordmark: {
    fontSize: 28,
    color: colors.foreground,
    fontFamily: fonts.sansBold,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    letterSpacing: 0.2,
  },
});
