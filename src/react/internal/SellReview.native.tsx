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
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import { assetImageUrl, formatSats, formatUsd, sellingDisplay } from "./format.js";
import {
  FEE_OPTIONS,
  type FeeOption,
  type UseSellReviewResult,
} from "./useSellReview.js";

const FEE_LABELS: Record<FeeOption, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

const MONOGRAM_PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#0ea5e9",
  "#84cc16",
];

function hashHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return MONOGRAM_PALETTE[Math.abs(h) % MONOGRAM_PALETTE.length];
}

function avatarBadge(asset: AssetOption): { label: string; bg: string } {
  switch (asset.type) {
    case "counterparty":
      return {
        label: asset.assetName === "XCP" ? "XCP" : asset.assetName.slice(0, 4),
        bg: asset.assetName === "XCP" ? "#EC1550" : hashHue(asset.assetName),
      };
    case "zeld":
      return { label: "ZELD", bg: "#2563eb" };
    case "kor":
      return { label: "KOR", bg: "#f59e0b" };
    case "kontor-nft":
      return { label: "NFT", bg: "#a855f7" };
    case "ordinal":
      return { label: "ORD", bg: hashHue(asset.inscriptionId) };
  }
}

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
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarImage: { width: 56, height: 56, borderRadius: 14 },
    avatarText: { color: "#fff", fontWeight: "700", fontSize: 13 },
    assetName: {
      fontSize: theme.typography.fontSizeLg,
      fontWeight: "600",
      color: theme.colors.text,
    },
    muted: { fontSize: theme.typography.fontSizeBase, color: theme.colors.textMuted },
    sellingSub: { fontSize: theme.typography.fontSizeBase, color: theme.colors.text },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
    },
    feeChips: { flexDirection: "row", gap: 4 },
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
    bigNumber: { fontSize: 27, fontWeight: "700", color: theme.colors.text },
    satsTag: { flexDirection: "row", alignItems: "center", gap: 6 },
    btcCircle: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#F7931A",
      alignItems: "center",
      justifyContent: "center",
    },
    btcGlyph: { color: "#fff", fontWeight: "700", fontSize: 13 },
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

/** Orange Bitcoin badge + "Sats" label (placeholder for the BtcGold mark). */
function SatsTag({ sheet }: { sheet: ReturnType<typeof createSheet> }) {
  return (
    <View style={sheet.satsTag}>
      <View style={sheet.btcCircle}>
        <Text style={sheet.btcGlyph}>₿</Text>
      </View>
      <Text style={sheet.satsLabel}>Sats</Text>
    </View>
  );
}

/** Explanations shown via the tappable (i) hints, keeping the panel compact. */
const FEE_HINTS = {
  attach:
    "Miner fee to place your asset on its own UTXO (Counterparty attach / ZELD transfer) so the swap can be created.",
  network:
    "Miner fee for the separate transaction that pays the platform listing fee.",
  listing: "Platform fee for listing your asset on the marketplace.",
};

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

/**
 * Asset thumbnail: the real artwork from the Horizon Market asset-image endpoint,
 * falling back to a colored monogram badge when it's missing or fails to load.
 */
function AssetAvatar({
  asset,
  imageUrl,
  sheet,
}: {
  asset: AssetOption;
  imageUrl: string;
  sheet: ReturnType<typeof createSheet>;
}) {
  // Track the failed URL so switching assets re-attempts the new image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === imageUrl) {
    const badge = avatarBadge(asset);
    return (
      <View style={[sheet.avatar, { backgroundColor: badge.bg }]}>
        <Text style={sheet.avatarText}>{badge.label}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: imageUrl }}
      onError={() => setFailedUrl(imageUrl)}
      style={sheet.avatarImage}
    />
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

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* You're selling */}
      <View style={sheet.section}>
        <Text style={sheet.sectionLabel}>You&apos;re selling</Text>
        <View style={sheet.sellingRow}>
          <AssetAvatar asset={asset} imageUrl={imageUrl} sheet={sheet} />
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
        <View style={sheet.headerRow}>
          <Text style={sheet.sectionLabel}>You&apos;ll pay to list</Text>
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
                    {FEE_LABELS[opt]} {rate ?? "…"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {isKontor ? (
          <>
            <View style={sheet.amountRow}>
              <View>
                <Text style={sheet.bigNumber}>
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
              <SatsTag sheet={sheet} />
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
              {kontorListingSats != null ? (
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
              <View>
                <Text style={sheet.bigNumber}>
                  {cost ? formatSats(cost.total) : previewLoading ? "…" : "—"}
                </Text>
                {totalUsd ? <Text style={sheet.muted}>{totalUsd}</Text> : null}
              </View>
              <SatsTag sheet={sheet} />
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
