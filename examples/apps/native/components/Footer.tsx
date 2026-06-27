import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NETWORKS, type UiNetwork } from "../lib/networks.js";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

interface FooterProps {
  network: UiNetwork;
  onChange: (network: UiNetwork) => void;
}

/**
 * Slim bottom bar holding the mainnet ⇄ signet toggle. Rendered OUTSIDE
 * <HorizonMarketProvider> (so it survives the provider's key={network} remount)
 * but inside the SafeAreaView, and pads for the bottom inset.
 */
export function Footer({ network, onChange }: FooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
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
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
});
