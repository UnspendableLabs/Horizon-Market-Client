import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { NETWORKS, type UiNetwork } from "../lib/networks.js";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

interface FooterProps {
  network: UiNetwork;
  onChange: (network: UiNetwork) => void;
}

const legalLinks = [
  { href: "https://horizon.market/terms", label: "Terms of Service" },
  { href: "https://horizon.market/privacy", label: "Privacy Policy" },
];

/** The Horizon "H" mark (the three solid strokes of the brand logo). */
function HorizonLogo({ size = 26 }: { size?: number }) {
  return (
    <Svg width={(size * 30) / 32} height={size} viewBox="0 0 30 32" fill="none">
      <Path
        d="M21.4878 32L21.4878 -3.72007e-07L30 0L30 32L21.4878 32Z"
        fill={colors.foreground}
      />
      <Path
        d="M8.52151 9.28361e-08L8.52151 32L0.00927734 32L0.00927772 0L8.52151 9.28361e-08Z"
        fill={colors.foreground}
      />
      <Path
        d="M30 0C30 6.44873 28.8983 12.0857 24.732 16.1336C21.7832 18.9985 18.3761 19.7193 16.0975 20.2014C16.022 20.2174 15.9478 20.2331 15.8749 20.2486C13.4758 20.7588 12.289 21.089 11.2354 22.0791C10.0985 23.3099 9.51438 24.3276 9.14525 25.5562C8.72774 26.9459 8.51223 28.8476 8.51223 32H0C0 28.5963 0.212818 25.6785 0.999977 23.0584C1.8275 20.304 3.20691 18.1391 5.12604 16.0891L5.1953 16.0151L5.26795 15.9446C8.21333 13.0828 11.6186 12.3625 13.8952 11.8809C13.9719 11.8647 14.0473 11.8488 14.1214 11.833C16.5692 11.3124 17.7579 10.9781 18.8317 9.93474C20.4494 8.36307 21.4878 5.72688 21.4878 0H30Z"
        fill={colors.foreground}
      />
    </Svg>
  );
}

/** X (Twitter) glyph. */
function XIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M13.936 4.698H15.02L10.34 9.063L15.85 16.365H11.54L8.16 11.937L4.29 16.365H2.15L7.16 10.624L1.88 3.699H6.3L9.35 7.745L13.936 4.698ZM13.13 15.079H14.32L6.65 4.917H5.37L13.13 15.079Z"
        fill={colors.offWhite}
      />
    </Svg>
  );
}

/** Telegram / send (paper plane) glyph. */
function TelegramIcon({ size = 15 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2 11 13"
        stroke={colors.offWhite}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M22 2 15 22 11 13 2 9 22 2Z"
        stroke={colors.offWhite}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Compact site footer (mobile-adapted version of the web app's footer): the
 * mainnet ⇄ signet network switch, a Legal links row, brand mark + social icons,
 * and the copyright line. Rendered OUTSIDE <HorizonMarketProvider> (so it
 * survives the provider's key={network} remount), inside the SafeAreaView.
 */
export function Footer({ network, onChange }: FooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      {/* Network switch */}
      <View style={styles.networkRow}>
        <Text style={styles.label}>Network</Text>
        <View style={styles.segmentGroup}>
          {ORDER.map((n) => {
            const active = n === network;
            return (
              <Pressable
                key={n}
                onPress={() => {
                  if (!active) onChange(n);
                }}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {NETWORKS[n].label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Legal links + brand + socials */}
      <View style={styles.linksRow}>
        <HorizonLogo size={24} />
        <View style={styles.legalLinks}>
          {legalLinks.map((link) => (
            <Pressable key={link.href} onPress={() => void Linking.openURL(link.href)}>
              <Text style={styles.legalText}>{link.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.socials}>
          <Pressable
            onPress={() => void Linking.openURL("https://twitter.com/hznmarket")}
            style={styles.socialButton}
            accessibilityLabel="X (Twitter)"
          >
            <XIcon size={15} />
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL("https://t.me/HorizonXCP")}
            style={styles.socialButton}
            accessibilityLabel="Telegram"
          >
            <TelegramIcon size={15} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.copyright}>
        © {new Date().getFullYear()} Unspendable Labs. All rights reserved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },

  label: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },

  segmentGroup: {
    flexDirection: "row",
    alignItems: "center",
    padding: 2,
    gap: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
  },

  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.full,
  },

  segmentActive: {
    backgroundColor: colors.primary,
  },

  segmentText: {
    fontSize: 12,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },

  segmentTextActive: {
    color: colors.primaryForeground,
  },

  linksRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },

  legalLinks: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },

  legalText: {
    fontSize: 12,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },

  socials: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  socialButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceHover,
    borderRadius: radii.sm,
  },

  copyright: {
    fontSize: 11,
    textAlign: "center",
    color: colors.muted,
    fontFamily: fonts.sans,
  },
});
