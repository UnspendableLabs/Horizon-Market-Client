import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { authenticate, canUseAppLock } from "../lib/app-lock.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

/**
 * Settings-tab block for the address-derivation choice:
 *   - a switch to use the Horizon Wallet (BIP39) derivation instead of the
 *     default single-key model that matches horizon.market;
 *   - when on, a biometric-gated "reveal recovery phrase" (12 words) so the
 *     wallet can be re-imported into the Horizon Wallet extension / XVerse and
 *     reach the same addresses.
 *
 * 12 words (not 24): Horizon Wallet only imports 12-word phrases, and XVerse
 * accepts 12 too — so 12 is the one length that works everywhere. Driven through
 * the SDK context (setDerivationMode); the root layout persists the choice.
 */
export function DerivationSettings() {
  const { addresses, derivationMode, setDerivationMode, exportMnemonic } =
    useHorizonMarket();

  const bip39 = derivationMode === "horizon-wallet";
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Drop a revealed phrase whenever the mode changes — it would refer to a
  // different wallet.
  useEffect(() => {
    setRevealed(null);
    setCopied(false);
  }, [derivationMode]);

  const reveal = async () => {
    // Gate behind the OS auth sheet when the device supports it (same lock the
    // app already uses); on a lock-less device fall back to revealing directly.
    if (await canUseAppLock()) {
      if (!(await authenticate())) return;
    }
    setRevealed(exportMnemonic());
  };

  const copy = async () => {
    if (!revealed) return;
    try {
      await Clipboard.setStringAsync(revealed);
      setCopied(true);
    } catch {
      /* ignore clipboard failures */
    }
  };

  const words = revealed ? revealed.trim().split(/\s+/) : [];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Wallet</Text>

      {/* Mode switch */}
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchTitle}>Use BIP39 derivation</Text>
            <Text style={styles.switchSub}>
              {bip39
                ? "BIP84 + BIP86 — exportable to Horizon Wallet / XVerse."
                : "Off — addresses match horizon.market (single key)."}
            </Text>
          </View>
          <Switch
            value={bip39}
            onValueChange={(on) =>
              setDerivationMode(on ? "horizon-wallet" : "horizon-market")
            }
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.foreground}
          />
        </View>
      </View>

      {bip39 && (
        <>
          {/* Reveal recovery phrase (12 words) */}
          {addresses ? (
            <View style={styles.revealBlock}>
              <Pressable
                onPress={() => {
                  if (revealed) {
                    setRevealed(null);
                    setCopied(false);
                  } else {
                    void reveal();
                  }
                }}
                style={styles.revealButton}
                accessibilityRole="button"
              >
                <Text style={styles.revealButtonText}>
                  {revealed
                    ? "Hide recovery phrase"
                    : "Reveal recovery phrase (12 words)"}
                </Text>
              </Pressable>

              {revealed && (
                <>
                  <View style={styles.wordGrid}>
                    {words.map((w, i) => (
                      <View key={`${i}-${w}`} style={styles.wordChip}>
                        <Text style={styles.wordIndex}>{i + 1}</Text>
                        <Text style={styles.wordText}>{w}</Text>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => void copy()}
                    style={styles.copyButton}
                    accessibilityRole="button"
                  >
                    <Text style={styles.copyButtonText}>
                      {copied ? "Copied ✓" : "Copy"}
                    </Text>
                  </Pressable>
                  <Text style={styles.hint}>
                    Import these 12 words into Horizon Wallet or XVerse to reach
                    the same addresses shown here.
                  </Text>
                  <Text style={styles.warning}>
                    Anyone with this phrase controls the funds on these addresses.
                    Never share it. Store it offline.
                  </Text>
                </>
              )}
            </View>
          ) : (
            <Text style={styles.hint}>
              Connect your wallet to export its recovery phrase.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  switchText: { flex: 1, gap: 2 },
  switchTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  switchSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
  revealBlock: { gap: spacing.sm, marginTop: spacing.xs },
  revealButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  revealButtonText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  wordGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  wordChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wordIndex: { fontSize: 12, color: colors.muted, fontFamily: fonts.mono },
  wordText: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  copyButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  copyButtonText: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  warning: {
    fontSize: 12,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
});
