/**
 * Fixed brand header — the full Horizon wordmark (the H mark + "Horizon"),
 * tappable to return to the Buy tab, on a slim bar pinned above the tab pager,
 * with the search, profile and menu entry points on the right. It sits OUTSIDE the swipeable scenes, so it never scrolls with a tab's
 * content and stays put while swiping between tabs, mirroring the fixed bottom
 * {@link TabBar}. The root SafeAreaView already pads the top inset, so the bar
 * starts right under the status bar.
 */
import { useState, type ReactElement } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

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

/** lucide `menu` — the hamburger that opens {@link HeaderMenu}. */
function MenuIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6h16M4 12h16M4 18h16"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** lucide `layout-grid` — the Token Explorer's browse grid. */
function GridIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[
        { x: 3, y: 3 },
        { x: 14, y: 3 },
        { x: 14, y: 14 },
        { x: 3, y: 14 },
      ].map((rect) => (
        <Rect
          key={`${rect.x}:${rect.y}`}
          x={rect.x}
          y={rect.y}
          width={7}
          height={7}
          rx={1}
          stroke={color}
          strokeWidth={2}
        />
      ))}
    </Svg>
  );
}

/** lucide `plus` — issue a new token. */
function PlusIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5v14M5 12h14"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Everything the hamburger opens. The action first, then the destination. */
const MENU_ITEMS: {
  label: string;
  path: string;
  icon: (props: { color: string }) => ReactElement;
}[] = [
  {
    label: "Create",
    path: "/create",
    icon: (props) => <PlusIcon color={props.color} />,
  },
  {
    label: "Token Explorer",
    path: "/token-explorer",
    icon: (props) => <GridIcon color={props.color} />,
  },
];

/**
 * The hamburger's sheet — a dropdown pinned under the bar's right edge.
 *
 * A `Modal` rather than an absolutely-positioned view inside the bar: the
 * header is one row of a screen that also holds a scroll view and the tab bar,
 * so a panel drawn in it would be clipped by the first ancestor that scrolls.
 * The modal is drawn over everything, which also gives the backdrop a real tap
 * target for dismissal.
 */
function HeaderMenu({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  // The modal covers the whole window, status bar included, while the header
  // sits below the safe-area inset the root SafeAreaView applies — so the panel
  // has to add that inset back to land under the bar rather than over it.
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Android's back button dismisses via onRequestClose above; iOS has the
      // backdrop below.
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View style={[styles.menu, { top: insets.top + BAR_HEIGHT }]}>
        {MENU_ITEMS.map((item, index) => (
          <View key={item.path}>
            {index > 0 && <View style={styles.menuDivider} />}
            <Pressable
              onPress={() => onSelect(item.path)}
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.menuItemPressed,
              ]}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
            >
              {item.icon({ color: colors.primary })}
              <Text style={styles.menuLabel}>{item.label}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </Modal>
  );
}

export function Header() {
  const router = useRouter();
  const { addresses } = useHorizonMarket();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.bar}>
      {/* The wordmark is the way home, as on the website: it goes to Buy, the
          first tab. `navigate` (not `push`) so tapping it from a root-stack
          route — profile, search, a token — pops back to the pager rather than
          stacking another copy of it, same as the tab bar's own buttons. */}
      <Pressable
        onPress={() => router.navigate("/")}
        hitSlop={spacing.sm}
        accessibilityRole="button"
        accessibilityLabel="Horizon Market — go to Buy"
      >
        <Image source={wordmark} style={styles.logo} resizeMode="contain" />
      </Pressable>
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
        {/* Rightmost, where a thumb reaches it: the app's non-tab destinations,
            which are pages rather than modes and so don't belong in the bottom
            bar. */}
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={styles.iconButton}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel="Menu"
          accessibilityState={{ expanded: menuOpen }}
        >
          <MenuIcon color={colors.mutedStrong} />
        </Pressable>
      </View>

      <HeaderMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSelect={(path) => {
          setMenuOpen(false);
          // `navigate`, like the tab buttons: re-picking the destination the
          // user is already on returns to it instead of stacking a second copy.
          router.navigate(path);
        }}
      />
    </View>
  );
}

/** Bar height, shared with the menu so the panel lands under it exactly. */
const BAR_HEIGHT = 52;

const styles = StyleSheet.create({
  bar: {
    height: BAR_HEIGHT,
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

  // RN 0.86 merged `absoluteFillObject` into `absoluteFill` (see BrandCover).
  backdrop: { ...StyleSheet.absoluteFill },
  menu: {
    position: "absolute",
    right: spacing.sm,
    minWidth: 240,
    maxWidth: 320,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
    overflow: "hidden",
  },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  menuItemPressed: { backgroundColor: colors.surfaceHover },
  menuLabel: {
    flexShrink: 1,
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
});
