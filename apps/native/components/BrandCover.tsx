/**
 * Brand cover — the H mark centered on the app background, a pixel continuation of
 * the native splash. Single source of truth for every full-bleed brand screen so
 * they stay identical: the app-lock boot cover, the app-lock overlay, and the
 * app-switcher privacy screen. (Previously the privacy screen drifted to a
 * wordmark + tagline while the lock showed just the H — this keeps them in sync.)
 *
 * These covers live inside the app's SafeAreaView (top inset), but the native
 * splash centers on the FULL screen. So the overlay is pulled up by the top inset
 * (`useBrandOverlayStyle`) to land the logo on the true screen center — otherwise
 * it sits ~half the status-bar height too low and the splash → cover handoff
 * visibly jumps.
 */
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../lib/theme.js";

// The H mark. Same size (200px) and background as app.json → expo-splash-screen's
// imageWidth, so the JS cover is a pixel-continuation of the OS splash. Square:
// icon.png carries its own dark padding, so `contain` on colors.background is seamless.
const brandMark = require("../assets/icon.png");

/** The H mark alone — for callers that supply their own overlay wrapper (e.g. the
 *  interactive lock screen, which needs a Pressable rather than this plain View). */
export function BrandMark() {
  return (
    <Image source={brandMark} style={styles.logo} resizeMode="contain" />
  );
}

/**
 * The inset-corrected full-bleed overlay style, shared by every brand cover so an
 * interactive wrapper (Pressable) lines up pixel-for-pixel with the plain covers.
 */
export function useBrandOverlayStyle(): StyleProp<ViewStyle> {
  const insets = useSafeAreaInsets();
  return [styles.overlay, { top: -insets.top }];
}

/** Non-interactive full-bleed brand cover: the H mark centered on the background. */
export function BrandCover(props: ViewProps) {
  const overlay = useBrandOverlayStyle();
  return (
    <View {...props} style={[overlay, props.style]}>
      <BrandMark />
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque full-bleed cover: sits above every screen so nothing behind it is
  // visible or tappable. Extended to the full screen (top: -insets.top, applied by
  // useBrandOverlayStyle) so its centered logo lands exactly where the splash's does.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 200,
    height: 200,
  },
});
