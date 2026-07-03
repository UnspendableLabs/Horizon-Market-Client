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
import { swapListItemView } from "./swapListHelpers.js";
import { NoImageIcon } from "./icons.native.js";
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
  iconSize,
  iconColor,
  labelStyle,
  imageOverride,
  placeholderOverride,
  resizeMode = "cover",
  showLabel,
}: {
  thumbnailUrl: string | null;
  imageStyle: StyleProp<ImageStyle>;
  placeholderStyle: StyleProp<ViewStyle>;
  iconSize: number;
  iconColor: string;
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
      {/* Mountain + sun "no image" pictogram, matching the web tile placeholder. */}
      <NoImageIcon size={iconSize} color={iconColor} />
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

  // Quantity rides beside the asset name ("0.01 XCP"); the meta line carries
  // only the per-unit price, matching how horizon.market lays these out.
  const { actionLabel, thumbnail, title, priceLabel, pricePerUnit, showPerUnit } =
    swapListItemView(swap, isMySwap);

  return (
    <View style={[common.swapItemCard, style, stylesProp?.root]}>
      <View style={sheet.imageGridPanel}>
        <ThumbnailOrPlaceholder
          thumbnailUrl={thumbnail}
          imageStyle={[sheet.imageGrid as ImageStyle]}
          placeholderStyle={[common.swapItemPlaceholder, sheet.imageGrid]}
          iconSize={44}
          iconColor={theme.colors.textMuted}
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
        {title}
      </Text>
      <Text style={[common.muted, stylesProp?.price]}>
        {priceLabel}
      </Text>
      {showPerUnit && (
        <Text style={[common.muted, stylesProp?.meta]} numberOfLines={1}>
          {pricePerUnit} sats/unit
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
