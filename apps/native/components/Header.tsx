/**
 * Fixed brand header — the full Horizon wordmark (the H mark + "Horizon") on a
 * slim bar pinned above the tab pager, with the profile entry point on the
 * right. It sits OUTSIDE the swipeable scenes, so it never scrolls with a tab's
 * content and stays put while swiping between tabs, mirroring the fixed bottom
 * {@link TabBar}. The root SafeAreaView already pads the top inset, so the bar
 * starts right under the status bar.
 */
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle, Path } from "react-native-svg";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { colors, radii, spacing } from "../lib/theme.js";

// 1500×304 source — sized here at a 24px height with the width matching the
// asset's aspect ratio, so `contain` never letterboxes it.
const wordmark = require("../assets/logo-wordmark.png");
const LOGO_HEIGHT = 24;
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 1500) / 304);

/** lucide `search` — the token-search entry point. */
function SearchIcon({ color, size = 21 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={2} />
      <Path
        d="m21 21-4.3-4.3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** lucide `circle-user-round` — the profile entry point. */
function UserIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 20a6 6 0 0 0-12 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={4} stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function Header() {
  const router = useRouter();
  const { addresses } = useHorizonMarket();

  return (
    <View style={styles.bar}>
      <Image source={wordmark} style={styles.logo} resizeMode="contain" />
      {/* Both are root-stack routes, not tabs: they push over the pager (tab bar
          included) and pop back to wherever the user was. Disconnected users
          land on the same login gate the Sell / Wallet tabs show. */}
      <View style={styles.actions}>
        {/* Search needs no wallet — it reads the public tokens API. */}
        <Pressable
          onPress={() => router.navigate("/search")}
          style={styles.iconButton}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel="Search tokens"
        >
          <SearchIcon color={colors.mutedStrong} />
        </Pressable>
        <Pressable
          onPress={() => router.navigate("/profile")}
          style={styles.iconButton}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          <UserIcon color={addresses ? colors.primary : colors.mutedStrong} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
});
