import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  Modal,
  useHorizonMarket,
  useKontorFaucet,
} from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  trackWalletFaucetCompleted,
  trackWalletFaucetOpened,
} from "../lib/analytics/events.js";

/** lucide `droplet` — a faucet grant of test coins. */
function DropletIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Faucet button for the KOR row of the SDK's `<WalletBalances/>`, injected
 * through its `renderTokenAction` slot so it sits with Deposit / Withdraw / Sell
 * rather than in some other corner of the screen.
 *
 * Kontor charges gas in KOR and drops the operation of an account holding none,
 * so a signet wallet with an empty KOR balance can't buy, sell, or even buy KOR
 * — the faucet is the only way in. `useKontorFaucet()` reports `available: false`
 * off signet (mainnet has no faucet) or for a wallet with no taproot key to
 * credit, and this renders nothing in that case.
 */
export function KorFaucetAction() {
  const { refreshBalances } = useHorizonMarket();
  const { available, amountKor, status, result, error, request, reset } =
    useKontorFaucet();
  const [open, setOpen] = useState(false);

  // Reported from the status transition, not from the click handler: `request()`
  // resolves to nothing (the outcome lives in the hook's state), and `status`
  // captured in the handler's closure is still the pre-request value. Declared
  // above the early return below — hooks can't sit behind a condition.
  useEffect(() => {
    if (status === "success") trackWalletFaucetCompleted("success");
    else if (status === "error") trackWalletFaucetCompleted("error");
  }, [status]);

  if (!available) return null;

  const pending = status === "requesting";

  const close = () => {
    // The request can't be cancelled and its outcome needs somewhere to land,
    // so the modal stays up until the faucet answers.
    if (pending) return;
    setOpen(false);
    // The KOR arrives when the faucet's reveal confirms — a block away — but a
    // user who read the success screen and closed it may well be past that.
    if (status === "success") refreshBalances();
    reset();
  };

  const openModal = () => {
    reset();
    setOpen(true);
    trackWalletFaucetOpened();
  };

  return (
    <>
      <Pressable
        onPress={openModal}
        style={styles.iconAction}
        accessibilityRole="button"
        accessibilityLabel="Get free test KOR from the signet faucet"
      >
        <DropletIcon color={colors.foreground} />
      </Pressable>

      <Modal open={open} onClose={close} title="Get test KOR">
        <View style={styles.body}>
          {/* The pitch is only worth reading before the outcome; once the faucet
              has answered, its txids or its refusal are the message. */}
          {(status === "idle" || pending) && (
            <Text style={styles.lead}>
              The signet faucet sends {amountKor} KOR to your Kontor account, for
              free. Test coins — worthless outside signet.
            </Text>
          )}

          {pending && (
            <View style={styles.pendingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Requesting {amountKor} KOR…</Text>
            </View>
          )}

          {status === "success" && result && (
            <View style={styles.resultBlock}>
              <Text style={styles.success}>
                {amountKor} KOR on the way — the balance updates once the faucet
                transaction confirms, which takes a block.
              </Text>
              <FaucetTxid label="commit" txid={result.commitTxid} />
              <FaucetTxid label="reveal" txid={result.revealTxid} />
            </View>
          )}

          {status === "error" && error && (
            <Text style={styles.error}>{error.message}</Text>
          )}

          <View style={styles.footer}>
            {(status === "idle" || status === "error") && (
              <>
                <Pressable
                  onPress={close}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>
                    {status === "error" ? "Close" : "Cancel"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void request()}
                  style={styles.primaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>
                    {status === "error" ? "Retry" : `Request ${amountKor} KOR`}
                  </Text>
                </Pressable>
              </>
            )}
            {status === "success" && (
              <Pressable
                onPress={close}
                style={styles.primaryButton}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Close</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

/** One faucet txid, opening the signet explorer. Skipped when the Portal omits it. */
function FaucetTxid({ label, txid }: { label: string; txid: string }) {
  if (!txid) return null;
  return (
    <Pressable
      onPress={() =>
        void Linking.openURL(`https://mempool.space/signet/tx/${txid}`)
      }
      accessibilityRole="link"
    >
      <Text style={styles.txid} numberOfLines={1}>
        {label}: {txid.slice(0, 10)}…{txid.slice(-8)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Matches the SDK's own icon actions in the same row (30×30, 1px border).
  iconAction: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  body: { gap: spacing.md },
  lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
  },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  muted: { fontSize: 13, color: colors.muted, fontFamily: fonts.sans },
  resultBlock: { gap: spacing.sm },
  success: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.success,
    fontFamily: fonts.sans,
  },
  error: { fontSize: 13, color: colors.error, fontFamily: fonts.sans },
  txid: {
    fontSize: 12,
    color: colors.offWhite,
    fontFamily: fonts.mono,
    textDecorationLine: "underline",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
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
  primaryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryText: {
    fontSize: 14,
    color: colors.primaryForeground,
    fontFamily: fonts.sansSemiBold,
  },
});
