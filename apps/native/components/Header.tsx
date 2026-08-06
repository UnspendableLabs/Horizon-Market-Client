/**
 * Fixed brand header — the full Horizon wordmark (the H mark + "Horizon") on a
 * slim bar pinned above the tab pager. It sits OUTSIDE the swipeable scenes, so
 * it never scrolls with a tab's content and stays put while swiping between
 * tabs, mirroring the fixed bottom {@link TabBar}. The root SafeAreaView already
 * pads the top inset, so the bar starts right under the status bar.
 */
import { Image, StyleSheet, View } from "react-native";
import { colors, spacing } from "../lib/theme.js";

// 1500×304 source — sized here at a 24px height with the width matching the
// asset's aspect ratio, so `contain` never letterboxes it.
const wordmark = require("../assets/logo-wordmark.png");
const LOGO_HEIGHT = 24;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 1500) / 304);

export function Header() {
  return (
    <View style={styles.bar}>
      <Image source={wordmark} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
});
