import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  ACCOUNT_DELETION_MESSAGE_MAX_LENGTH,
  Modal,
  parseAccountDeletionAddresses,
  useAccountDeletion,
} from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  trackAccountDeletionOpened,
  trackAccountDeletionRequested,
} from "../lib/analytics/events.js";

/** lucide `trash-2` — the conventional destructive mark. */
function TrashIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6h14ZM10 11v6M14 11v6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** What deleting the account does, in the order it matters to the person asking. */
const CONSEQUENCES = [
  "Your account, profile, linked wallets and sessions are removed.",
  "Any listing you still have open is delisted.",
  "Completed trades are Bitcoin transactions and stay on-chain.",
  "A Kontor offer is escrowed on-chain: revoke it from your wallet before asking, or it stands after the account is gone.",
  "Your wallet and the coins in it are untouched — this deletes the Horizon Market account, not the wallet.",
];

/**
 * "Delete account" in Settings — App Store guideline 5.1.1(v), which requires
 * an account-creating app to offer account deletion from inside the app.
 *
 * It files a *request* rather than deleting anything: an admin matches it to a
 * user and deletes it by hand (`POST /api/account-deletion-requests`). The
 * server has no self-service delete, and the copy here says so rather than
 * implying the account is gone on the way out of the modal.
 *
 * The flow works without a wallet, deliberately — someone locked out of the
 * account is exactly who this exists for. A connected wallet's addresses ride
 * along and the client's bearer token proves the account is theirs, which is
 * what lets the request take over one somebody else filed for the same
 * identity; with no wallet the form needs an email or an address to name.
 */
export function DeleteAccount() {
  const {
    walletAddresses,
    canProveOwnership,
    status,
    result,
    error,
    submit,
    reset,
  } = useAccountDeletion();

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState("");
  const [addresses, setAddresses] = useState("");
  const [message, setMessage] = useState("");

  const pending = status === "submitting";
  const connected = walletAddresses.length > 0;
  const typedAddresses = parseAccountDeletionAddresses(addresses);
  // The request has to name something an admin can match to an account. A
  // connected wallet already does; otherwise the form has to collect it.
  const named = connected || email.trim() !== "" || typedAddresses.length > 0;

  const openModal = () => {
    reset();
    setConfirming(false);
    setEmail("");
    setAddresses("");
    setMessage("");
    setOpen(true);
    trackAccountDeletionOpened({ connected });
  };

  const close = () => {
    // The request can't be cancelled and its outcome needs somewhere to land.
    if (pending) return;
    setOpen(false);
    setConfirming(false);
    reset();
  };

  const send = async () => {
    await submit({
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(typedAddresses.length > 0 ? { addresses: typedAddresses } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    });
  };

  // Reported from the status transition, not the press handler: `submit()`
  // resolves to nothing and the closure's `status` is the pre-submit value.
  useEffect(() => {
    if (status !== "success" || !result) return;
    trackAccountDeletionRequested({
      duplicate: result.duplicate,
      verified: result.verified,
    });
  }, [status, result]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.card}>
        <Pressable
          onPress={openModal}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
        >
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <TrashIcon color={colors.error} />
              <Text style={styles.rowTitle}>Delete account</Text>
            </View>
            <Text style={styles.rowSub}>
              Ask us to delete your Horizon Market account and the data attached
              to it.
            </Text>
          </View>
          <Text style={styles.rowArrow}>›</Text>
        </Pressable>
      </View>

      <Modal
        open={open}
        onClose={close}
        title={confirming ? "Are you sure?" : "Delete your account"}
      >
        <View style={styles.body}>
          {status === "success" ? (
            <>
              <Text style={styles.success}>
                {result?.duplicate
                  ? "A request for this account is already pending."
                  : "Request received."}
              </Text>
              <Text style={styles.lead}>
                Our team will review it and delete the account. If we need to
                confirm anything we'll reach out at the email you gave.
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
          ) : confirming ? (
            <>
              <Text style={styles.lead}>
                This asks us to delete the account for good. It can't be undone,
                and you'll need to start over to trade on Horizon Market again.
              </Text>
              {status === "error" && error && (
                <Text style={styles.error}>{error.message}</Text>
              )}
              <View style={styles.footer}>
                <Pressable
                  onPress={() => {
                    if (pending) return;
                    setConfirming(false);
                  }}
                  disabled={pending}
                  style={[styles.secondaryButton, pending && styles.disabled]}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={() => void send()}
                  disabled={pending}
                  style={[styles.dangerButton, pending && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending }}
                >
                  {pending ? (
                    <ActivityIndicator color={colors.foreground} />
                  ) : (
                    <Text style={styles.dangerText}>
                      {status === "error" ? "Try again" : "Delete my account"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.form}>
                <Text style={styles.lead}>
                  Deletion isn't instant — this sends a request our team reviews
                  before removing anything.
                </Text>

                <View style={styles.list}>
                  {CONSEQUENCES.map((line) => (
                    <View key={line} style={styles.listItem}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.listText}>{line}</Text>
                    </View>
                  ))}
                </View>

                {connected ? (
                  <View style={styles.identity}>
                    <Text style={styles.identityLabel}>
                      {canProveOwnership
                        ? "Signed in — this request is tied to your account"
                        : "Your connected wallet"}
                    </Text>
                    {walletAddresses.map((address) => (
                      <Text
                        key={address}
                        style={styles.identityAddress}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {address}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hint}>
                    You're not connected, so tell us which account to delete —
                    the email you signed in with, the addresses you connected,
                    or both.
                  </Text>
                )}

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>
                    Email{" "}
                    <Text style={styles.fieldOptional}>
                      {connected ? "(optional)" : ""}
                    </Text>
                  </Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    editable={!pending}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    style={styles.input}
                    accessibilityLabel="Email"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>
                    Other wallet addresses{" "}
                    <Text style={styles.fieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    value={addresses}
                    onChangeText={setAddresses}
                    editable={!pending}
                    placeholder="One address per line"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    style={[styles.input, styles.inputMultiline]}
                    accessibilityLabel="Other wallet addresses"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>
                    Anything else?{" "}
                    <Text style={styles.fieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    value={message}
                    onChangeText={setMessage}
                    editable={!pending}
                    multiline
                    maxLength={ACCOUNT_DELETION_MESSAGE_MAX_LENGTH}
                    style={[styles.input, styles.inputMultiline]}
                    accessibilityLabel="Message"
                  />
                </View>

                {status === "invalid" && (
                  <Text style={styles.error}>
                    Enter the email or at least one address of the account.
                  </Text>
                )}
                {status === "error" && error && (
                  <Text style={styles.error}>{error.message}</Text>
                )}
              </View>

              <View style={styles.footer}>
                <Pressable
                  onPress={close}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => setConfirming(true)}
                  disabled={!named}
                  style={[styles.dangerButton, !named && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !named }}
                >
                  <Text style={styles.dangerText}>Continue</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surfaceHover },
  rowText: { flex: 1, gap: 2 },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowTitle: {
    fontSize: 15,
    color: colors.error,
    fontFamily: fonts.sansSemiBold,
  },
  rowSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },
  rowArrow: { fontSize: 20, color: colors.muted },

  body: { gap: spacing.md },
  // No ScrollView of its own: `Modal` already scrolls its children, and a
  // second vertical one inside it fights the first for the drag.
  form: { gap: spacing.md },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
  success: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.success,
    fontFamily: fonts.sansSemiBold,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.error,
    fontFamily: fonts.sans,
  },

  list: { gap: spacing.xs },
  listItem: { flexDirection: "row", gap: spacing.sm },
  bullet: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  listText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },

  identity: {
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  identityLabel: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  identityAddress: {
    fontSize: 12,
    color: colors.foreground,
    fontFamily: fonts.mono,
  },

  field: { gap: spacing.xs },
  fieldLabel: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  fieldOptional: { color: colors.muted, fontFamily: fonts.sans },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },

  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dangerButton: {
    minWidth: 140,
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.error,
  },
  dangerText: {
    fontSize: 14,
    color: colors.background,
    fontFamily: fonts.sansSemiBold,
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
