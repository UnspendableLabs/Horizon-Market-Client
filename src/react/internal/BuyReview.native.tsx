import { useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import { buyingDisplay, formatSats, formatUsd, truncate } from "./format.js";
import { swapMonogram } from "./swapListHelpers.js";
import { BtcGoldIcon } from "./icons.native.js";
import {
  FEE_HINTS,
  FEE_LABELS,
  FEE_OPTIONS,
  type UseBuyReviewResult,
} from "./useBuyReview.js";

export interface BuyReviewStyles {
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
  buttonSecondary?: StyleProp<ViewStyle>;
  buttonSecondaryText?: StyleProp<TextStyle>;
}

export interface BuyReviewProps {
  swap: AtomicSwap;
  review: UseBuyReviewResult;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  styles?: BuyReviewStyles;
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
    buyingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    avatarLabel: { color: "#fff", fontWeight: "700", fontSize: 13 },
    assetName: {
      fontSize: theme.typography.fontSizeLg,
      fontWeight: "600",
      color: theme.colors.text,
    },
    buyingSub: { fontSize: theme.typography.fontSizeBase, color: theme.colors.text },
    muted: { fontSize: theme.typography.fontSizeBase, color: theme.colors.textMuted },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: theme.spacing.sm,
    },
    feeChips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    chip: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radii.sm,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    chipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    chipText: { fontSize: theme.typography.fontSizeSm, color: theme.colors.textMuted },
    chipTextActive: { color: theme.colors.primaryForeground, fontWeight: "600" },
    amountRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
    },
    bigNumber: { fontSize: 28, fontWeight: "700", color: theme.colors.text },
    satsTag: { flexDirection: "row", alignItems: "center", gap: 6 },
    satsLabel: { color: theme.colors.text, fontWeight: "600" },
    divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.xs },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
    },
    metaValue: { color: theme.colors.text, fontSize: theme.typography.fontSizeSm },
    breakRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
    },
    breakValue: { color: theme.colors.text, fontWeight: "600", textAlign: "right" },
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
    pendingNote: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
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

type Sheet = ReturnType<typeof createSheet>;

/** Orange Bitcoin mark + "Sats" label. */
function SatsTag({ sheet }: { sheet: Sheet }) {
  return (
    <View style={sheet.satsTag}>
      <BtcGoldIcon size={22} />
      <Text style={sheet.satsLabel}>Sats</Text>
    </View>
  );
}

/** Small circled "i" that reveals its explanation in an alert on tap. */
function InfoHint({ title, text, sheet }: { title: string; text: string; sheet: Sheet }) {
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

function SatsValue({ sats, btcUsd, sheet }: { sats: number; btcUsd: number | null; sheet: Sheet }) {
  const usd = formatUsd(sats, btcUsd);
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={sheet.breakValue}>{formatSats(sats)} SATS</Text>
      {usd ? <Text style={sheet.muted}>{usd}</Text> : null}
    </View>
  );
}

/** Purchase thumbnail: listing artwork with a colored monogram fallback. */
function SwapAvatar({ swap, sheet }: { swap: AtomicSwap; sheet: Sheet }) {
  const [failed, setFailed] = useState(false);
  const url = swap.thumbnailUrl ?? swap.imageUrl;
  const { label, bg } = swapMonogram(swap);
  const showImage = Boolean(url) && !failed;
  return (
    <View style={[sheet.avatar, { backgroundColor: bg }]}>
      <Text style={sheet.avatarLabel}>{label}</Text>
      {showImage ? (
        <Image
          source={{ uri: url as string }}
          onError={() => setFailed(true)}
          style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
        />
      ) : null}
    </View>
  );
}

export function BuyReview({
  swap,
  review,
  isSubmitting,
  onConfirm,
  onCancel,
  styles: stylesProp,
}: BuyReviewProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);

  const {
    feeOption,
    setFeeOption,
    rateFor,
    btcUsd,
    isKontor,
    priceSats,
    royaltySats,
    minerFeeSats,
    totalSats,
    totalDisplay,
    networkFeeHint,
    minerFeePending,
    previewError,
    canConfirm,
  } = review;

  const buying = buyingDisplay(swap);
  const totalUsd = totalSats != null ? formatUsd(totalSats, btcUsd) : null;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* You'll receive */}
      <View style={sheet.section}>
        <Text style={sheet.sectionLabel}>You&apos;ll receive</Text>
        <View style={sheet.buyingRow}>
          <SwapAvatar swap={swap} sheet={sheet} />
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={sheet.assetName}>{buying.name}</Text>
            {buying.sub ? <Text style={sheet.buyingSub}>{buying.sub}</Text> : null}
          </View>
        </View>
        <View style={sheet.divider} />
        <View style={sheet.metaRow}>
          <Text style={sheet.sectionLabel}>Seller</Text>
          <Text style={sheet.metaValue}>{truncate(swap.sellerAddress)}</Text>
        </View>
        {swap.expiresAt ? (
          <View style={sheet.metaRow}>
            <Text style={sheet.sectionLabel}>Expires</Text>
            <Text style={sheet.metaValue}>
              {new Date(swap.expiresAt).toLocaleString()}
            </Text>
          </View>
        ) : null}
      </View>

      {/* You'll pay */}
      <View style={sheet.section}>
        <View style={sheet.headerRow}>
          <Text style={sheet.sectionLabel}>You&apos;ll pay</Text>
          <View style={sheet.feeChips}>
            {FEE_OPTIONS.map((opt) => {
              const active = opt === feeOption;
              const rate = rateFor(opt);
              return (
                <Pressable
                  key={opt}
                  onPress={() => setFeeOption(opt)}
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

        <View style={sheet.amountRow}>
          <View>
            <Text style={sheet.bigNumber}>{totalDisplay}</Text>
            {totalUsd ? <Text style={sheet.muted}>{totalUsd}</Text> : null}
          </View>
          <SatsTag sheet={sheet} />
        </View>

        <View style={sheet.divider} />

        <View style={sheet.breakRow}>
          <View style={sheet.breakLabelRow}>
            <Text style={sheet.muted}>Price</Text>
            <InfoHint title="Price" text={FEE_HINTS.price} sheet={sheet} />
          </View>
          <SatsValue sats={priceSats} btcUsd={btcUsd} sheet={sheet} />
        </View>

        {royaltySats != null && royaltySats > 0 ? (
          <View style={sheet.breakRow}>
            <View style={sheet.breakLabelRow}>
              <Text style={sheet.muted}>Royalty</Text>
              <InfoHint title="Royalty" text={FEE_HINTS.royalty} sheet={sheet} />
            </View>
            <SatsValue sats={royaltySats} btcUsd={btcUsd} sheet={sheet} />
          </View>
        ) : null}

        <View style={sheet.breakRow}>
          <View style={sheet.breakLabelRow}>
            <Text style={sheet.muted}>Network fee</Text>
            <InfoHint title="Network fee" text={networkFeeHint} sheet={sheet} />
          </View>
          {minerFeeSats != null ? (
            <SatsValue sats={minerFeeSats} btcUsd={btcUsd} sheet={sheet} />
          ) : (
            <Text style={sheet.breakValue}>{minerFeePending}</Text>
          )}
        </View>

        {isKontor ? (
          <Text style={sheet.pendingNote}>
            A Kontor purchase is composed locally at the selected fee rate when
            you confirm, so the exact miner fee is set at that point.
          </Text>
        ) : null}

        {previewError && !isKontor ? (
          <Text style={sheet.error}>
            Couldn&apos;t estimate the cost: {previewError.message}
          </Text>
        ) : null}
      </View>

      <Pressable
        disabled={isSubmitting || !canConfirm}
        onPress={onConfirm}
        style={[sheet.button, (isSubmitting || !canConfirm) && sheet.disabled, stylesProp?.button]}
      >
        <Text style={[sheet.buttonText, stylesProp?.buttonText]}>
          {isSubmitting ? "Confirming…" : "Confirm Purchase"}
        </Text>
      </Pressable>
      {onCancel ? (
        <Pressable
          disabled={isSubmitting}
          onPress={onCancel}
          style={[sheet.cancel, isSubmitting && sheet.disabled, stylesProp?.buttonSecondary]}
        >
          <Text style={[sheet.cancelText, stylesProp?.buttonSecondaryText]}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
