import { useMemo } from "react";
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
import type { SwapListView } from "../hooks/useSwapList.js";
import { useTheme } from "../hooks/useTheme.js";
import { useCommonSheet } from "./styles.native.js";
import {
  swapThumbnailUrl,
  swapDisplayName,
  swapDisplayQuantity,
} from "./swapListHelpers.js";
import type { ResolvedTheme } from "../theme.js";

const LISTING_INITIAL: Record<string, string> = {
  counterparty: "C",
  ordinal: "O",
  zeld: "Z",
};

export interface SwapListItemStyles {
  root?: StyleProp<ViewStyle>;
  image?: StyleProp<ImageStyle>;
  placeholder?: StyleProp<ViewStyle>;
  name?: StyleProp<TextStyle>;
  price?: StyleProp<TextStyle>;
  badge?: StyleProp<TextStyle>;
  meta?: StyleProp<TextStyle>;
  button?: StyleProp<ViewStyle>;
  buttonText?: StyleProp<TextStyle>;
}

export interface SwapListItemProps {
  swap: AtomicSwap;
  view: SwapListView;
  isMySwap: boolean;
  onAction: () => void;
  style?: StyleProp<ViewStyle>;
  styles?: SwapListItemStyles;
}

function ThumbnailOrPlaceholder({
  thumbnailUrl,
  listingType,
  imageStyle,
  placeholderStyle,
  placeholderTextStyle,
  imageOverride,
  placeholderOverride,
}: {
  thumbnailUrl: string | null;
  listingType: string;
  imageStyle: StyleProp<ImageStyle>;
  placeholderStyle: StyleProp<ViewStyle>;
  placeholderTextStyle: StyleProp<TextStyle>;
  imageOverride?: StyleProp<ImageStyle>;
  placeholderOverride?: StyleProp<ViewStyle>;
}) {
  if (thumbnailUrl) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        style={[imageStyle, imageOverride]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={[placeholderStyle, placeholderOverride]}>
      <Text style={placeholderTextStyle}>
        {LISTING_INITIAL[listingType] ?? "?"}
      </Text>
    </View>
  );
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    imageGrid: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: theme.radii.sm,
    },
    placeholderText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeLg,
      fontWeight: "600",
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.xs,
      flexWrap: "wrap",
    },
    infoCol: {
      flex: 1,
      gap: 2,
    },
    actionButton: {
      marginTop: theme.spacing.xs,
    },
    actionButtonSecondary: {
      marginTop: theme.spacing.xs,
    },
  });
}

export function SwapListItem({
  swap,
  view,
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

  if (view === "grid") {
    return (
      <View style={[common.swapItemCard, style, stylesProp?.root]}>
        <ThumbnailOrPlaceholder
          thumbnailUrl={thumbnail}
          listingType={swap.listingType}
          imageStyle={[sheet.imageGrid as ImageStyle]}
          placeholderStyle={[common.swapItemPlaceholder, sheet.imageGrid]}
          placeholderTextStyle={sheet.placeholderText}
          imageOverride={stylesProp?.image}
          placeholderOverride={stylesProp?.placeholder}
        />
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

  return (
    <View style={[common.swapItemRow, style, stylesProp?.root]}>
      <ThumbnailOrPlaceholder
        thumbnailUrl={thumbnail}
        listingType={swap.listingType}
        imageStyle={common.swapItemImageSmall as ImageStyle}
        placeholderStyle={common.swapItemPlaceholderSmall}
        placeholderTextStyle={sheet.placeholderText}
        imageOverride={stylesProp?.image}
        placeholderOverride={stylesProp?.placeholder}
      />
      <View style={sheet.infoCol}>
        <Text
          style={[common.swapItemName, stylesProp?.name]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <View style={sheet.infoRow}>
          <Text style={[common.swapItemBadge, stylesProp?.badge]}>
            {swap.listingType}
          </Text>
          {showMeta && metaText !== null && (
            <Text style={[common.muted, stylesProp?.meta]}>
              {metaText}
            </Text>
          )}
        </View>
      </View>
      <View>
        <Text style={[common.swapItemPrice, stylesProp?.price]}>
          {swap.price.toLocaleString()} sats
        </Text>
      </View>
      <Pressable
        onPress={onAction}
        style={[
          isMySwap ? common.buttonSecondary : common.button,
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
