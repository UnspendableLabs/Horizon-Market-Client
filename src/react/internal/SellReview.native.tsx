import { useMemo } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import { assetImageUrl, formatSats, formatUsd, sellingDisplay } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.native.js";
import { Dropdown } from "./Dropdown.native.js";
import {
  FEE_HINTS,
  FEE_LABELS,
  FEE_OPTIONS,
  type UseSellReviewResult,
} from "./useSellReview.js";

export interface SellReviewStyles {
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
}

export interface SellReviewProps {
  asset: AssetOption;
  quantity: string;
  priceSats: number;
  review: UseSellReviewResult;
  isSubmitting: boolean;
  onSign: () => void;
  onCancel: () => void;
  styles?: SellReviewStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    section: {
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    sectionLabel: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
    },
    sellingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
    assetName: {
      fontSize: theme.typography.fontSizeLg,
      fontWeight: "600",
      color: theme.colors.text,
    },
    muted: { fontSize: theme.typography.fontSizeBase, color: theme.colors.textMuted },
    sellingSub: { fontSize: theme.typography.fontSizeBase, color: theme.colors.text },
    // The fee-rate control reuses the shared Dropdown (same as the market's
    // filter/sort), kept compact to the right of the amount it drives.
    feeSelect: { flexShrink: 0, maxWidth: 200 },
    amountRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
    },
    amountBlock: { flexShrink: 1 },
    bigNumber: { fontSize: 27, fontWeight: "700", color: theme.colors.text },
    satsTag: { flexDirection: "row", alignItems: "center", gap: 6 },
    satsLabel: { color: theme.colors.text, fontWeight: "600" },
    divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.xs },
    breakRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    breakValue: { color: theme.colors.text, fontWeight: "600", textAlign: "right" },
    free: { color: theme.colors.success, fontWeight: "600" },
    breakLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    infoDot: {
      width: 15,
      height: 15,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.textMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    infoDotText: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      fontStyle: "italic",
      lineHeight: 11,
    },
    error: { fontSize: theme.typography.fontSizeSm, color: theme.colors.error },
    button: {
      padding: theme.spacing.md,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: {
      color: theme.colors.primaryForeground,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "600",
    },
    cancel: { padding: theme.spacing.sm, alignItems: "center" },
    cancelText: { color: theme.colors.textMuted, fontWeight: "500" },
    disabled: { opacity: 0.6 },
  });
}

/** Orange Bitcoin (BtcGold) mark + "Sats" label. */
function SatsTag({ sheet }: { sheet: ReturnType<typeof createSheet> }) {
  return (
    <View style={sheet.satsTag}>
      <BtcGoldIcon size={22} />
      <Text style={sheet.satsLabel}>Sats</Text>
    </View>
  );
}

/** Small circled "i" that reveals its explanation in an alert on tap. */
function InfoHint({
  title,
  text,
  sheet,
}: {
  title: string;
  text: string;
  sheet: ReturnType<typeof createSheet>;
}) {
  return (
    <Pressable
      hitSlop={8}
      onPress={() => Alert.alert(title, text)}
      accessibilityRole="button"
      accessibilityLabel={`${title} — more info`}
    >
      <View style={sheet.infoDot}>
        <Text style={sheet.infoDotText}>i</Text>
      </View>
    </Pressable>
  );
}

function SatsValue({
  sats,
  btcUsd,
  sheet,
}: {
  sats: number;
  btcUsd: number | null;
  sheet: ReturnType<typeof createSheet>;
}) {
  const usd = formatUsd(sats, btcUsd);
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={sheet.breakValue}>{formatSats(sats)} SATS</Text>
      {usd ? <Text style={sheet.muted}>{usd}</Text> : null}
    </View>
  );
}

export function SellReview({
  asset,
  quantity,
  priceSats,
  review,
  isSubmitting,
  onSign,
  onCancel,
  styles: stylesProp,
}: SellReviewProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const { baseUrl } = useHorizonMarket();

  const {
    estimates,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor,
    btcUsd,
    isKontor,
    cost,
    feeWaived,
    paidWithCredit,
    previewLoading,
    previewError,
    canSign,
    kontorListingSats,
    kontorListingLoading,
    kontorListingError,
    kontorMinerFeeSats,
    kontorTotalSats,
  } = review;

  const selling = sellingDisplay(asset, quantity);
  const imageUrl = assetImageUrl(baseUrl, asset);
  const priceUsd = formatUsd(priceSats, btcUsd);
  const totalUsd = cost ? formatUsd(cost.total, btcUsd) : null;

  const feeDropdown = (
    <Dropdown
      style={sheet.feeSelect}
      title="Fee rate"
      value={feeOption}
      onChange={setFeeOption}
      options={FEE_OPTIONS.map((opt) => ({
        value: opt,
        label: `${FEE_LABELS[opt]} · ${rateFor(opt) ?? "…"} sat/vB`,
      }))}
    />
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* You're selling */}
      <View style={sheet.section}>
        <Text style={sheet.sectionLabel}>You&apos;re selling</Text>
        <View style={sheet.sellingRow}>
          <AssetAvatar asset={asset} imageUrl={imageUrl} size={56} radius={14} />
          <View style={{ gap: 2 }}>
            <Text style={sheet.assetName}>{selling.name}</Text>
            {selling.sub ? (
              <Text style={sheet.sellingSub}>{selling.sub}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* You'll pay to list */}
      <View style={sheet.section}>
        <Text style={sheet.sectionLabel}>You&apos;ll pay to list</Text>

        {isKontor ? (
          <>
            <View style={sheet.amountRow}>
              <View style={sheet.amountBlock}>
                <Text style={sheet.bigNumber} numberOfLines={1}>
                  {kontorTotalSats != null
                    ? `≈ ${formatSats(kontorTotalSats)}`
                    : "…"}
                </Text>
                {kontorTotalSats != null &&
                formatUsd(kontorTotalSats, btcUsd) ? (
                  <Text style={sheet.muted}>
                    ≈ {formatUsd(kontorTotalSats, btcUsd)}
                  </Text>
                ) : null}
              </View>
              {feeDropdown}
            </View>
            <View style={sheet.divider} />
            <View style={sheet.breakRow}>
              <View style={sheet.breakLabelRow}>
                <Text style={sheet.muted}>Listing fee</Text>
                <InfoHint
                  title="Listing fee"
                  text={FEE_HINTS.listing}
                  sheet={sheet}
                />
              </View>
              {paidWithCredit ? (
                <Text style={sheet.free}>1 credit</Text>
              ) : feeWaived ? (
                <Text style={sheet.free}>Free</Text>
              ) : kontorListingSats != null ? (
                <SatsValue sats={kontorListingSats} btcUsd={btcUsd} sheet={sheet} />
              ) : (
                <Text style={sheet.breakValue}>
                  {kontorListingLoading ? "…" : "—"}
                </Text>
              )}
            </View>
            <View style={sheet.breakRow}>
              <View style={sheet.breakLabelRow}>
                <Text style={sheet.muted}>Attach miner fee</Text>
                <InfoHint
                  title="Attach miner fee"
                  text={`Estimated from a recent on-chain attach reveal at ${
                    feeRate ?? estimates?.halfHourFee ?? "…"
                  } sat/vB (assumes one funding input); the exact total is set when you sign.`}
                  sheet={sheet}
                />
              </View>
              {kontorMinerFeeSats != null ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={sheet.breakValue}>
                    ≈ {formatSats(kontorMinerFeeSats)} SATS
                  </Text>
                  {formatUsd(kontorMinerFeeSats, btcUsd) ? (
                    <Text style={sheet.muted}>
                      {formatUsd(kontorMinerFeeSats, btcUsd)}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text style={sheet.breakValue}>…</Text>
              )}
            </View>
            {kontorListingError ? (
              <Text style={sheet.error}>
                Couldn&apos;t estimate fees: {kontorListingError.message}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={sheet.amountRow}>
              <View style={sheet.amountBlock}>
                <Text style={sheet.bigNumber} numberOfLines={1}>
                  {cost ? formatSats(cost.total) : previewLoading ? "…" : "—"}
                </Text>
                {totalUsd ? <Text style={sheet.muted}>{totalUsd}</Text> : null}
              </View>
              {feeDropdown}
            </View>

            {cost ? (
              <>
                <View style={sheet.divider} />
                {cost.attach > 0 ? (
                  <View style={sheet.breakRow}>
                    <View style={sheet.breakLabelRow}>
                      <Text style={sheet.muted}>Attach fee</Text>
                      <InfoHint
                        title="Attach fee"
                        text={FEE_HINTS.attach}
                        sheet={sheet}
                      />
                    </View>
                    <SatsValue sats={cost.attach} btcUsd={btcUsd} sheet={sheet} />
                  </View>
                ) : null}
                {cost.network > 0 ? (
                  <View style={sheet.breakRow}>
                    <View style={sheet.breakLabelRow}>
                      <Text style={sheet.muted}>Network fee</Text>
                      <InfoHint
                        title="Network fee"
                        text={FEE_HINTS.network}
                        sheet={sheet}
                      />
                    </View>
                    <SatsValue sats={cost.network} btcUsd={btcUsd} sheet={sheet} />
                  </View>
                ) : null}
                <View style={sheet.breakRow}>
                  <View style={sheet.breakLabelRow}>
                    <Text style={sheet.muted}>Listing fee</Text>
                    <InfoHint
                      title="Listing fee"
                      text={FEE_HINTS.listing}
                      sheet={sheet}
                    />
                  </View>
                  {paidWithCredit ? (
                    <Text style={sheet.free}>1 credit</Text>
                  ) : feeWaived || cost.listing === 0 ? (
                    <Text style={sheet.free}>Free</Text>
                  ) : (
                    <SatsValue sats={cost.listing} btcUsd={btcUsd} sheet={sheet} />
                  )}
                </View>
              </>
            ) : null}

            {previewError && !cost ? (
              <Text style={sheet.error}>
                Couldn&apos;t estimate fees: {previewError.message}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* You'll receive when it sells */}
      <View style={sheet.section}>
        <Text style={sheet.sectionLabel}>You&apos;ll receive when it sells</Text>
        <View style={sheet.amountRow}>
          <View>
            <Text style={sheet.bigNumber}>{formatSats(priceSats)}</Text>
            {priceUsd ? <Text style={sheet.muted}>{priceUsd}</Text> : null}
          </View>
          <SatsTag sheet={sheet} />
        </View>
      </View>

      <Pressable
        disabled={isSubmitting || !canSign}
        onPress={onSign}
        style={[
          sheet.button,
          (isSubmitting || !canSign) && sheet.disabled,
          stylesProp?.button,
        ]}
      >
        <Text style={[sheet.buttonText, stylesProp?.buttonText]}>
          {isSubmitting ? "Signing…" : "Sign"}
        </Text>
      </Pressable>
      <Pressable
        disabled={isSubmitting}
        onPress={onCancel}
        style={[sheet.cancel, isSubmitting && sheet.disabled, stylesProp?.buttonSecondary]}
      >
        <Text style={[sheet.cancelText, stylesProp?.buttonSecondaryText]}>Cancel</Text>
      </Pressable>
    </View>
  );
}
