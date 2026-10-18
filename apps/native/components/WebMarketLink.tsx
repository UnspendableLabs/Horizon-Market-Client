import { Linking, Pressable, StyleSheet, Text } from "react-native";
import { useCanLinkToWebMarket } from "../lib/store-policy.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

/** `https://signet.horizon.market/x` → `signet.horizon.market`. */
function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "");
}

/**
 * "Trade on horizon.market ↗" — the iOS build's only way to the marketplace,
 * which it doesn't carry itself (see lib/store-policy).
 *
 * Renders nothing unless {@link useCanLinkToWebMarket} says so: on iOS, on the
 * United States App Store storefront only, the one where guideline 3.1.1 allows
 * linking to a purchase mechanism other than In-App Purchase. Nothing on
 * Android, whose app has the market itself.
 */
export function WebMarketLink({ url }: { url: string }) {
  const allowed = useCanLinkToWebMarket();
  if (!allowed) return null;

  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="link"
    >
      <Text style={styles.text}>Trade on {hostOf(url)} ↗</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  text: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
});
