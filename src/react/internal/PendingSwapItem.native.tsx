import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import { useHorizonMarket } from "../context.js";
import { useTheme } from "../hooks/useTheme.js";
import { mempoolTxUrl } from "./format.js";
import {
  pendingSwapTrackingTxid,
  swapListItemView,
  swapMonogram,
} from "./swapListHelpers.js";
import type { ResolvedTheme } from "../theme.js";

export interface PendingSwapItemStyles {
  root?: StyleProp<ViewStyle>;
  thumbnail?: StyleProp<ImageStyle>;
  title?: StyleProp<TextStyle>;
  price?: StyleProp<TextStyle>;
  status?: StyleProp<TextStyle>;
  trackLink?: StyleProp<TextStyle>;
}

const THUMB = 48;

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: theme.radii.sm,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    thumbLabel: { color: "#fff", fontWeight: "700", fontSize: 12 },
    body: { flex: 1, gap: 2, minWidth: 0 },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "600",
    },
    price: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
      marginTop: 2,
      flexWrap: "wrap",
    },
    status: {
      color: theme.colors.pending,
      fontSize: theme.typography.fontSizeSm,
      fontWeight: "600",
    },
    trackLink: {
      color: theme.colors.primary,
      fontSize: theme.typography.fontSizeSm,
      fontWeight: "600",
    },
  });
}

/**
 * A single "awaiting confirmation" row shown above the buy grid for the
 * connected wallet's own not-yet-funded listing: small thumbnail, the asset and
 * price, a spinner + "Awaiting confirmation" status, and (when a funding txid is
 * known) a mempool.space tracking link. Informational only — the listing can't
 * be bought until it's funded.
 */
export function PendingSwapItem({
  swap,
  style,
  styles: stylesProp,
}: {
  swap: AtomicSwap;
  style?: StyleProp<ViewStyle>;
  styles?: PendingSwapItemStyles;
}) {
  const theme = useTheme();
  const { network, kontorNetwork } = useHorizonMarket();
  const sheet = useMemo(() => createSheet(theme), [theme]);

  // `isMySwap` only drives the (unused here) action label; pass true so we don't
  // imply a Buy affordance. We just read thumbnail/title/price.
  const { thumbnail, title, priceLabel } = swapListItemView(swap, true);
  const monogram = swapMonogram(swap);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(thumbnail) && failedUrl !== thumbnail;

  const trackUrl = mempoolTxUrl(
    network,
    kontorNetwork,
    pendingSwapTrackingTxid(swap),
  );

  return (
    <View style={[sheet.root, style, stylesProp?.root]}>
      <View
        style={[
          sheet.thumb,
          { backgroundColor: showImage ? "transparent" : monogram.bg },
        ]}
      >
        {showImage ? (
          <Image
            source={{ uri: thumbnail as string }}
            style={[StyleSheet.absoluteFill as ImageStyle, stylesProp?.thumbnail]}
            resizeMode="cover"
            onError={() => setFailedUrl(thumbnail)}
          />
        ) : (
          <Text style={sheet.thumbLabel}>{monogram.label}</Text>
        )}
      </View>

      <View style={sheet.body}>
        <Text style={[sheet.title, stylesProp?.title]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[sheet.price, stylesProp?.price]}>{priceLabel}</Text>
        <View style={sheet.statusRow}>
          <ActivityIndicator size="small" color={theme.colors.pending} />
          <Text style={[sheet.status, stylesProp?.status]}>
            Awaiting confirmation
          </Text>
          {trackUrl && (
            <Text
              style={[sheet.trackLink, stylesProp?.trackLink]}
              onPress={() => void Linking.openURL(trackUrl)}
            >
              Track ↗
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
