import { useMemo } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import {
  assetImageUrl,
  formatSats,
  mempoolTxUrl,
} from "../internal/format.js";
import { AssetAvatar, BtcGoldIcon } from "../internal/icons.native.js";
import { ResultActions } from "../internal/ResultActions.native.js";
import { MONO_FONT, useCommonSheet } from "../internal/styles.native.js";
import {
  useWithdraw,
  WITHDRAW_FEE_LABELS as FEE_LABELS,
  WITHDRAW_FEE_OPTIONS,
  type WithdrawTarget,
} from "../hooks/useWithdraw.js";

export interface WithdrawFormStyles {
  root?: StyleProp<ViewStyle>;
  label?: StyleProp<TextStyle>;
  input?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
}

export interface WithdrawFormProps {
  /** The asset to withdraw (a BTC balance or an owned asset). */
  target: WithdrawTarget;
  onSuccess?: (txid: string) => void;
  onError?: (error: Error) => void;
  /** Dismiss handler — shows a "Close" button on the result screen. */
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: WithdrawFormStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    availableRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
    },
    fieldLabel: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    maxButton: { alignSelf: "flex-start", paddingVertical: 4 },
    maxButtonText: { color: theme.colors.primary, fontSize: theme.typography.fontSizeSm, fontWeight: "600" },
    feeChips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    chip: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radii.sm,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    chipActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
    chipText: { fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted },
    chipTextActive: { color: theme.colors.primaryForeground, fontWeight: "600" },
    section: {
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    sectionLabel: { fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted },
    sellingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
    btcTile: {
      width: 56,
      height: 56,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.backgroundElevated,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    assetName: { fontSize: theme.typography.fontSizeLg, fontWeight: "600", color: theme.colors.text },
    sellingSub: { fontSize: theme.typography.fontSizeBase, color: theme.colors.text },
    monoValue: { fontFamily: MONO_FONT, fontSize: theme.typography.fontSizeSm, color: theme.colors.text },
    amountRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
    bigNumber: { fontSize: 28, fontWeight: "700", color: theme.colors.text },
    satsTag: { flexDirection: "row", alignItems: "center", gap: 6 },
    satsLabel: { color: theme.colors.text, fontWeight: "600" },
    usdLine: { fontSize: theme.typography.fontSizeBase, color: theme.colors.textMuted },
    centerNote: {
      textAlign: "center",
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
      paddingVertical: theme.spacing.lg,
    },
    successTitle: { fontWeight: "700", color: theme.colors.text, fontSize: theme.typography.fontSizeLg },
    mempoolLink: { color: theme.colors.primary, fontWeight: "600" },
  });
}

/**
 * Withdraw (send) flow for a single wallet asset, rendered inside a Modal by
 * {@link WalletBalances}. Steps through `form → confirm → progress → result`,
 * consuming the platform-neutral {@link useWithdraw} engine (same as the web
 * renderer). The fee rate is chosen on the form; moving to review composes and
 * signs the transaction so the review shows the *exact* miner fee.
 */
export function WithdrawForm({
  target,
  onSuccess,
  onError,
  onClose,
  style,
  styles: stylesProp,
}: WithdrawFormProps) {
  const w = useWithdraw({ target, onSuccess, onError });
  const theme = useTheme();
  const common = useCommonSheet();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const { network, kontorNetwork, baseUrl } = useHorizonMarket();

  // ─── Form step ─────────────────────────────────────────────────────────────
  if (w.step === "form") {
    const submitDisabled = w.submitDisabled;
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        {w.availableDisplay ? (
          <View style={sheet.availableRow}>
            <Text style={common.muted}>Available</Text>
            <Text style={common.muted}>
              {w.availableDisplay} {w.assetLabel}
            </Text>
          </View>
        ) : null}

        <View>
          <Text style={[sheet.fieldLabel, stylesProp?.label]}>{w.destinationLabel}</Text>
          <TextInput
            value={w.formValues.destination}
            onChangeText={(t) => w.setFormValues({ destination: t.trim() })}
            placeholder={w.destinationPlaceholder}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={[common.input, stylesProp?.input]}
          />
        </View>

        {w.needsQuantity ? (
          <View>
            <Text style={[sheet.fieldLabel, stylesProp?.label]}>Amount</Text>
            <TextInput
              value={w.formValues.quantity}
              onChangeText={(t) => w.setFormValues({ quantity: t.replace(/[^0-9.]/g, "") })}
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              style={[common.input, stylesProp?.input]}
            />
            {w.availableDisplay && w.kind !== "btc" ? (
              <Pressable
                onPress={() => w.setFormValues({ quantity: w.availableDisplay! })}
                style={sheet.maxButton}
              >
                <Text style={sheet.maxButtonText}>Max ({w.availableDisplay})</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View>
          <Text style={[sheet.fieldLabel, stylesProp?.label]}>Network fee</Text>
          <View style={sheet.feeChips}>
            {WITHDRAW_FEE_OPTIONS.map((opt) => {
              const active = opt === w.feeOption;
              const rate = w.rateFor(opt);
              return (
                <Pressable
                  key={opt}
                  onPress={() => w.setFeeOption(opt)}
                  style={[sheet.chip, active && sheet.chipActive]}
                >
                  <Text style={[sheet.chipText, active && sheet.chipTextActive]}>
                    {FEE_LABELS[opt]} {rate ?? "…"} sat/vB
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {w.error ? <Text style={common.error}>{w.error.message}</Text> : null}

        <Pressable
          disabled={submitDisabled}
          onPress={w.submitForm}
          style={[common.button, submitDisabled && common.buttonDisabled, stylesProp?.button]}
        >
          <Text style={[common.buttonText, stylesProp?.buttonText]}>
            {w.isPreparing ? "Composing…" : "Review"}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ─── Review step ─────────────────────────────────────────────────────────────
  if (w.step === "confirm") {
    const display = w.withdrawingDisplay;
    const { exact: feeExact, sats: feeSats, usd: feeUsd } = w.reviewFee;
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        {/* You're withdrawing */}
        <View style={sheet.section}>
          <Text style={sheet.sectionLabel}>You&apos;re withdrawing</Text>
          <View style={sheet.sellingRow}>
            {target.type === "btc" ? (
              <View style={sheet.btcTile}>
                <BtcGoldIcon size={32} />
              </View>
            ) : (
              <AssetAvatar asset={target} size={56} imageUrl={assetImageUrl(baseUrl, target)} />
            )}
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={sheet.assetName}>{display.name}</Text>
              {display.sub ? <Text style={sheet.sellingSub}>{display.sub}</Text> : null}
            </View>
          </View>
        </View>

        {/* To */}
        <View style={sheet.section}>
          <Text style={sheet.sectionLabel}>To</Text>
          <Text style={sheet.monoValue}>{w.formValues.destination}</Text>
        </View>

        {/* Network fee */}
        <View style={sheet.section}>
          <Text style={sheet.sectionLabel}>Network fee</Text>
          <View style={sheet.amountRow}>
            <View>
              <Text style={sheet.bigNumber}>
                {feeSats != null ? `${feeExact ? "" : "≈ "}${formatSats(feeSats)}` : "…"}
              </Text>
              {feeUsd ? (
                <Text style={sheet.usdLine}>
                  {feeExact ? "" : "≈ "}
                  {feeUsd}
                </Text>
              ) : null}
            </View>
            <View style={sheet.satsTag}>
              <BtcGoldIcon size={22} />
              <Text style={sheet.satsLabel}>Sats</Text>
            </View>
          </View>
          {w.isKontor ? (
            <Text style={common.muted}>
              Estimated at {w.feeRate ?? "…"} sat/vB — Kontor sets the exact fee
              when you confirm.
            </Text>
          ) : null}
        </View>

        {w.error ? <Text style={common.error}>{w.error.message}</Text> : null}

        <View style={common.actions}>
          <Pressable
            disabled={w.isSubmitting}
            onPress={w.goBack}
            style={[common.buttonSecondary, common.flex1, w.isSubmitting && common.buttonDisabled, stylesProp?.buttonSecondary]}
          >
            <Text style={[common.buttonSecondaryText, stylesProp?.buttonSecondaryText]}>Back</Text>
          </Pressable>
          <Pressable
            disabled={w.isSubmitting}
            onPress={() => void w.confirmAndSend()}
            style={[common.button, common.flex1, w.isSubmitting && common.buttonDisabled, stylesProp?.button]}
          >
            <Text style={[common.buttonText, stylesProp?.buttonText]}>
              {w.isSubmitting ? "Sending…" : "Confirm & send"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Progress step ───────────────────────────────────────────────────────────
  if (w.step === "progress") {
    return (
      <View style={[common.panelBody, style, stylesProp?.root]}>
        <Text style={sheet.centerNote}>Broadcasting your transaction…</Text>
      </View>
    );
  }

  // ─── Result step ─────────────────────────────────────────────────────────────
  const txid = w.result?.txid ?? null;
  const trackUrl = txid ? mempoolTxUrl(network, kontorNetwork, txid) : null;
  return (
    <View style={[common.panelBody, style, stylesProp?.root]}>
      {w.status === "success" ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text style={sheet.successTitle}>Sent!</Text>
          {txid ? (
            <View>
              <Text style={sheet.sectionLabel}>Transaction</Text>
              {trackUrl ? (
                <Text
                  style={[sheet.monoValue, sheet.mempoolLink]}
                  onPress={() => void Linking.openURL(trackUrl)}
                >
                  {txid}
                </Text>
              ) : (
                <Text style={sheet.monoValue}>{txid}</Text>
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={common.error}>{w.error?.message ?? "Something went wrong."}</Text>
      )}
      <ResultActions
        isError={w.status === "error"}
        onBack={w.goBack}
        onRetry={w.retry}
        onComplete={w.reset}
        completeLabel="New withdrawal"
        onClose={onClose}
        sheet={common}
        styles={{
          button: stylesProp?.button,
          buttonText: stylesProp?.buttonText,
          buttonSecondary: stylesProp?.buttonSecondary,
          buttonSecondaryText: stylesProp?.buttonSecondaryText,
        }}
      />
    </View>
  );
}
