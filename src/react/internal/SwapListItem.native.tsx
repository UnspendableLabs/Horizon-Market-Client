import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import { useTheme } from "../hooks/useTheme.js";
import { useCommonSheet } from "./styles.native.js";
import {
  swapThumbnailUrl,
  swapDisplayName,
  swapDisplayQuantity,
} from "./swapListHelpers.js";
import type { ResolvedTheme } from "../theme.js";

export interface SwapListItemStyles {
  root?: StyleProp<ViewStyle>;
  image?: StyleProp<ImageStyle>;
  placeholder?: StyleProp<ViewStyle>;
  name?: StyleProp<TextStyle>;
  price?: StyleProp<TextStyle>;
  meta?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
}

export interface SwapListItemProps {
  swap: AtomicSwap;
  isMySwap: boolean;
  onAction: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: SwapListItemStyles;
}

function ThumbnailOrPlaceholder({
  thumbnailUrl,
  imageStyle,
  placeholderStyle,
  iconStyle,
  labelStyle,
  imageOverride,
  placeholderOverride,
  resizeMode = "cover",
  showLabel,
}: {
  thumbnailUrl: string | null;
  imageStyle: StyleProp<ImageStyle>;
  placeholderStyle: StyleProp<ViewStyle>;
  iconStyle: StyleProp<TextStyle>;
  labelStyle: StyleProp<TextStyle>;
  imageOverride?: StyleProp<ImageStyle>;
  placeholderOverride?: StyleProp<ViewStyle>;
  resizeMode?: "cover" | "contain";
  showLabel: boolean;
}) {
  const [errored, setErrored] = useState(false);
  if (thumbnailUrl && !errored) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        style={[imageStyle, imageOverride]}
        resizeMode={resizeMode}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <View style={[placeholderStyle, placeholderOverride]}>
      {/* Picture-frame glyph (mountain + sun) as the "no image" pictogram. */}
      <Text style={iconStyle}>🖼️</Text>
      {showLabel && <Text style={labelStyle}>No image available</Text>}
    </View>
  );
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    // Square panel behind the artwork: subtle background, square corners, and
    // padding that insets the (contained) artwork from the panel edges.
    imageGridPanel: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: 0,
      // Dark panel behind the artwork, matching Horizon Market's
      // `bg-transpBlack-33`.
      backgroundColor: "rgba(0, 0, 0, 0.33)",
      padding: 24,
    },
    // The artwork/placeholder fills the padded panel.
    imageGrid: {
      width: "100%",
      height: "100%",
    },
    noImageIconGrid: {
      fontSize: 40,
    },
    noImageLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
      marginTop: theme.spacing.xs,
    },
    actionButton: {
      // Pin to the bottom of the equal-height tile so buttons align across the
      // grid row.
      marginTop: "auto",
      // Match the header "Sell" button height: the shared `button` style uses
      // spacing.md (12px) vertical padding, the header uses 8px.
      paddingVertical: theme.spacing.sm,
    },
  });
}

export function SwapListItem({
  swap,
  isMySwap,
  onAction,
  style,
  styles: stylesProp,
}: SwapListItemProps) {
  const theme = useTheme();
  const common = useCommonSheet();
  const sheet = useMemo(() => createSheet(theme), [theme]);

  const actionLabel = isMySwap ? "Delist" : "Buy";
  const thumbnail = swapThumbnailUrl(swap);
  const displayName = swapDisplayName(swap);
  const displayQuantity = swapDisplayQuantity(swap);
  const showMeta =
    swap.listingType !== "ordinal" &&
    (displayQuantity !== null || swap.pricePerUnit !== null);

  const metaText =
    displayQuantity !== null && swap.pricePerUnit !== null
      ? `${displayQuantity} × ${swap.pricePerUnit.toLocaleString()} sats/unit`
      : displayQuantity !== null
        ? `Qty: ${displayQuantity}`
        : swap.pricePerUnit !== null
          ? `${swap.pricePerUnit.toLocaleString()} sats/unit`
          : null;

  return (
    <View style={[common.swapItemCard, style, stylesProp?.root]}>
      <View style={sheet.imageGridPanel}>
        <ThumbnailOrPlaceholder
          thumbnailUrl={thumbnail}
          imageStyle={[sheet.imageGrid as ImageStyle]}
          placeholderStyle={[common.swapItemPlaceholder, sheet.imageGrid]}
          iconStyle={sheet.noImageIconGrid}
          labelStyle={sheet.noImageLabel}
          imageOverride={stylesProp?.image}
          placeholderOverride={stylesProp?.placeholder}
          resizeMode="contain"
          showLabel
        />
      </View>
      <Text
        style={[common.swapItemName, stylesProp?.name]}
        numberOfLines={1}
      >
        {displayName}
      </Text>
      <Text style={[common.muted, stylesProp?.price]}>
        {swap.price.toLocaleString()} sats
      </Text>
      {showMeta && metaText !== null && (
        <Text style={[common.muted, stylesProp?.meta]} numberOfLines={1}>
          {metaText}
        </Text>
      )}
      <Pressable
        onPress={onAction}
        style={[
          isMySwap ? common.buttonSecondary : common.button,
          sheet.actionButton,
          stylesProp?.button,
        ]}
      >
        <Text
          style={[
            isMySwap ? common.buttonSecondaryText : common.buttonText,
            stylesProp?.buttonText,
          ]}
        >
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}
