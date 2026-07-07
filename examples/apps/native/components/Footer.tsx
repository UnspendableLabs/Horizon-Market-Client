import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, Modal } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NETWORKS, type UiNetwork } from "../lib/networks.js";
import { useNetwork } from "../lib/network-context.js";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

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

/** Gear / settings glyph (lucide `Settings`) — opens the network picker. */
function GearIcon({ size = 16, color = colors.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/**
 * Compact site footer (mobile-adapted version of the web app's footer): the
 * brand mark + Legal links + social icons, then a bottom line with the copyright
 * (left) and a discreet gear (right) that opens the mainnet ⇄ signet network
 * picker. Rendered at the end of each screen's scroll so it's only seen once the
 * user scrolls to the bottom; reads the network from {@link useNetwork}.
 */
export function Footer() {
  const { network, setNetwork } = useNetwork();
  const [networkOpen, setNetworkOpen] = useState(false);

  return (
    <View style={styles.footer}>
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

      {/* Copyright (left) + discreet network gear (right) */}
      <View style={styles.bottomRow}>
        <Text style={styles.copyright}>
          © {new Date().getFullYear()} Unspendable Labs. All rights reserved.
        </Text>
        <Pressable
          onPress={() => setNetworkOpen(true)}
          style={styles.gearButton}
          hitSlop={8}
          accessibilityLabel={`Network: ${NETWORKS[network].label}`}
        >
          <GearIcon size={16} color={colors.muted} />
        </Pressable>
      </View>

      {/* Network picker */}
      <Modal
        visible={networkOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNetworkOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNetworkOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Network</Text>
            {ORDER.map((n) => {
              const active = n === network;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    if (!active) setNetwork(n);
                    setNetworkOpen(false);
                  }}
                  style={[styles.netOption, active && styles.netOptionActive]}
                >
                  <Text style={[styles.netOptionText, active && styles.netOptionTextActive]}>
                    {NETWORKS[n].label}
                  </Text>
                  {active && <Text style={styles.netCheck}>✓</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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

  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },

  copyright: {
    flex: 1,
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.sans,
  },

  gearButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },

  /* Network picker modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },

  modalCard: {
    width: "100%",
    maxWidth: 320,
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radii.lg,
  },

  modalTitle: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },

  netOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
  },

  netOptionActive: {
    backgroundColor: colors.primary,
  },

  netOptionText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },

  netOptionTextActive: {
    color: colors.primaryForeground,
  },

  netCheck: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
