import { Fragment } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { NETWORKS, type UiNetwork } from "../../lib/networks.js";
import { useNetwork } from "../../lib/network-context.js";
import { DerivationSettings } from "../../components/DerivationSettings.js";
import { colors, fonts, radii, spacing } from "../../lib/theme.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

const LEGAL_LINKS = [
  { href: "https://horizon.market/terms", label: "Terms of Service" },
  { href: "https://horizon.market/privacy", label: "Privacy Policy" },
];

const SOCIALS = [
  { href: "https://twitter.com/hznmarket", label: "X (Twitter)", Icon: XIcon },
  { href: "https://t.me/HorizonXCP", label: "Telegram", Icon: TelegramIcon },
];

/** X (Twitter) glyph. */
function XIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M13.936 4.698H15.02L10.34 9.063L15.85 16.365H11.54L8.16 11.937L4.29 16.365H2.15L7.16 10.624L1.88 3.699H6.3L9.35 7.745L13.936 4.698ZM13.13 15.079H14.32L6.65 4.917H5.37L13.13 15.079Z"
        fill={colors.offWhite}
      />
    </Svg>
  );
}

/** Telegram (paper plane) glyph. */
function TelegramIcon({ size = 16 }: { size?: number }) {
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
 * Settings tab: the network switch (Mainnet ⇄ Signet) plus an "About" block
 * (legal links, socials, copyright) rehomed from the old site footer. Switching
 * networks remounts the market provider (see the root layout's key={network}),
 * which re-derives addresses for the chosen network.
 */
export default function SettingsScreen() {
  const { network, setNetwork } = useNetwork();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      {/* Network */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Network</Text>
        <View style={styles.options}>
          {ORDER.map((n) => {
            const active = n === network;
            return (
              <Pressable
                key={n}
                onPress={() => {
                  if (!active) setNetwork(n);
                }}
                style={[styles.option, active && styles.optionActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.optionText, active && styles.optionTextActive]}
                >
                  {NETWORKS[n].label}
                </Text>
                {active && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Signet is a test network — balances and listings there aren't real.
        </Text>
      </View>

      {/* Wallet: address-derivation mode + recovery-phrase export */}
      <DerivationSettings />

      {/* About: legal links + socials + copyright (from the old footer) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>About</Text>

        <View style={styles.card}>
          {LEGAL_LINKS.map((link, i) => (
            <Fragment key={link.href}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable
                onPress={() => void Linking.openURL(link.href)}
                style={styles.linkRow}
                accessibilityRole="link"
              >
                <Text style={styles.linkText}>{link.label}</Text>
                <Text style={styles.linkArrow}>↗</Text>
              </Pressable>
            </Fragment>
          ))}
        </View>

        <View style={styles.socials}>
          {SOCIALS.map(({ href, label, Icon }) => (
            <Pressable
              key={href}
              onPress={() => void Linking.openURL(href)}
              style={styles.socialButton}
              accessibilityRole="link"
              accessibilityLabel={label}
            >
              <Icon size={16} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.copyright}>
          © {new Date().getFullYear()} Unspendable Labs. All rights reserved.
        </Text>
      </View>
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
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  optionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  optionTextActive: {
    color: colors.primaryForeground,
  },
  check: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },

  /* About */
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  linkText: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  linkArrow: {
    fontSize: 15,
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  socials: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  socialButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceHover,
    borderRadius: radii.sm,
  },
  copyright: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
});
