import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import {
  LISTING_REPORT_DETAILS_MAX_LENGTH,
  LISTING_REPORT_REASONS,
  LISTING_REPORT_REASON_LABELS,
  Modal,
  reportableListingQueryFor,
  useHorizonMarket,
  useReportListing,
  type ListingReportReason,
  type TokenDetail,
} from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  trackTokenReportOpened,
  trackTokenReportSubmitted,
} from "../lib/analytics/events.js";

/** lucide `flag` — the conventional "report this" mark. */
function FlagIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.3 2 1.8 0 2.7-.6 3.5-1a.5.5 0 0 1 .7.4V14a1 1 0 0 1-.4.8 6 6 0 0 1-3.6 1.2c-3 0-5-2-7.3-2-1.8 0-2.7.6-3.5 1"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * "Report" on the token page — the App Store's guideline 1.2 mechanism for
 * flagging objectionable content, placed where the content is.
 *
 * A report names a *listing* (the one key every asset type shares), so the
 * hook resolves this token's listing query to a swap on submit: an open offer,
 * else a past sale, else a delisted one. A token nobody ever listed has no
 * report target on the server; the modal says so instead of pretending.
 *
 * Reporting is session-gated so the reporter is identifiable. With no wallet
 * the modal points at the Wallet tab (the app's sign-in entry); with a wallet
 * whose sign-in is still landing it waits, the same way /profile does.
 */
export function ReportTokenButton({ token }: { token: TokenDetail }) {
  const router = useRouter();
  const { addresses, signInError } = useHorizonMarket();
  const target = useMemo(() => reportableListingQueryFor(token), [token]);
  const { canReport, status, result, error, submit, reset } = useReportListing({
    target,
  });

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ListingReportReason | null>(null);
  const [details, setDetails] = useState("");

  // Reported from the status transition, not the press handler: `submit()`
  // resolves to nothing and the closure's `status` is the pre-submit value.
  useEffect(() => {
    if (status === "success" && reason) {
      trackTokenReportSubmitted({
        protocol: token.protocol,
        reason,
        duplicate: result?.duplicate ?? false,
      });
    }
  }, [status, reason, result, token.protocol]);

  const pending = status === "submitting";

  const openModal = () => {
    reset();
    setReason(null);
    setDetails("");
    setOpen(true);
    trackTokenReportOpened({ protocol: token.protocol });
  };

  const close = () => {
    // The request can't be cancelled and its outcome needs somewhere to land.
    if (pending) return;
    setOpen(false);
    reset();
  };

  const goToWallet = () => {
    setOpen(false);
    reset();
    router.navigate("/wallet");
  };

  const canSubmit = canReport && reason !== null && !pending;

  return (
    <>
      <Pressable
        onPress={openModal}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        hitSlop={spacing.sm}
        accessibilityRole="button"
        accessibilityLabel={`Report ${token.name}`}
      >
        <FlagIcon color={colors.muted} />
        <Text style={styles.triggerText}>Report</Text>
      </Pressable>

      <Modal open={open} onClose={close} title="Report this token">
        <View style={styles.body}>
          {!addresses ? (
            <>
              <Text style={styles.lead}>
                Reports are tied to an account so we can follow up. Connect a
                wallet from the Wallet tab, then come back here.
              </Text>
              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={goToWallet}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Connect wallet</Text>
                </Pressable>
              </View>
            </>
          ) : !canReport ? (
            <>
              {signInError ? (
                <>
                  <Text style={styles.lead}>
                    Signing in to Horizon Market failed, so this report can't be
                    filed yet.
                  </Text>
                  <Text style={styles.error}>{signInError}</Text>
                </>
              ) : (
                <View style={styles.pendingRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.muted}>
                    Signing in to Horizon Market with your wallet…
                  </Text>
                </View>
              )}
              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Close</Text>
                </Pressable>
              </View>
            </>
          ) : status === "success" ? (
            <>
              <Text style={styles.success}>
                {result?.duplicate
                  ? "You had already reported this token. Your report is with our moderators."
                  : "Thanks — your report is with our moderators. Content that breaks our rules is removed from Horizon Market."}
              </Text>
              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </View>
            </>
          ) : status === "unlisted" ? (
            <>
              <Text style={styles.lead}>
                This token has never been listed on Horizon Market, so there is
                no listing to report. If it shows up for sale, report it from
                its offer.
              </Text>
              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>Close</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.lead}>
                Tell us what's wrong with{" "}
                <Text style={styles.leadStrong}>{token.name}</Text>. Reports go
                to Horizon Market's moderators, who can remove the listing.
              </Text>

              <View
                style={styles.reasons}
                accessibilityRole="radiogroup"
                accessibilityLabel="Reason"
              >
                {LISTING_REPORT_REASONS.map((value) => {
                  const selected = reason === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setReason(value)}
                      disabled={pending}
                      style={[styles.reason, selected && styles.reasonSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                    >
                      <View
                        style={[styles.radio, selected && styles.radioSelected]}
                      >
                        {selected && <View style={styles.radioDot} />}
                      </View>
                      <Text
                        style={[
                          styles.reasonText,
                          selected && styles.reasonTextSelected,
                        ]}
                      >
                        {LISTING_REPORT_REASON_LABELS[value]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={details}
                onChangeText={setDetails}
                editable={!pending}
                placeholder="Anything else we should know? (optional)"
                placeholderTextColor={colors.muted}
                multiline
                maxLength={LISTING_REPORT_DETAILS_MAX_LENGTH}
                style={styles.input}
                accessibilityLabel="Details"
              />

              {status === "error" && error && (
                <Text style={styles.error}>{error.message}</Text>
              )}

              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  disabled={pending}
                  style={[styles.secondaryButton, pending && styles.disabled]}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!reason) return;
                    void submit({ reason, details });
                  }}
                  disabled={!canSubmit}
                  style={[styles.primaryButton, !canSubmit && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSubmit }}
                >
                  {pending ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={styles.primaryText}>
                      {status === "error" ? "Retry" : "Send report"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // A quiet text control, not a call to action: it must be findable by anyone
  // looking for it without competing with the name it sits under.
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  triggerPressed: { opacity: 0.6 },
  triggerText: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },

  body: { gap: spacing.md },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },
  leadStrong: { color: colors.foreground, fontFamily: fonts.sansSemiBold },
  muted: { fontSize: 13, color: colors.muted, fontFamily: fonts.sans },
  success: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.success,
    fontFamily: fonts.sans,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
    fontFamily: fonts.sans,
  },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  reasons: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  reason: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  reasonSelected: { backgroundColor: colors.surfaceHover },
  reasonText: {
    fontSize: 14,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },
  reasonTextSelected: {
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },

  input: {
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlignVertical: "top",
  },

  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryButton: {
    minWidth: 120,
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryText: {
    fontSize: 14,
    color: colors.primaryForeground,
    fontFamily: fonts.sansSemiBold,
  },
  secondaryButton: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  disabled: { opacity: 0.5 },
});
