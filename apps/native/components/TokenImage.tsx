import { useState } from "react";
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, G, Path, SvgUri } from "react-native-svg";
import type { TokenRef } from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts } from "../lib/theme.js";

/**
 * A token's artwork, with a readable stand-in for the many tokens that have
 * none.
 *
 * Three things the plain `<Image source={{ uri }}/>` this replaces got wrong:
 *
 * 1. **SVG.** React Native's `<Image>` decodes PNG/JPEG/GIF/WebP and nothing
 *    else, so a token whose artwork is a vector (KOR, served as
 *    `/kontor-mark.svg`) silently failed to paint. Those go through `SvgUri`.
 * 2. **XCP.** The tokens API has no artwork for it and answers with the generic
 *    placeholder, even though Counterparty's mark is a brand asset this app
 *    already draws elsewhere. Drawn here rather than pointed at the website's
 *    `xcp-logo.png`, which is hardcoded to the mainnet origin and so would be
 *    the wrong host on signet.
 * 3. **Placeholders.** Most Counterparty assets carry no image anywhere, so the
 *    API answers with a deterministic pastel gradient — the same one
 *    horizon.market draws, so a token looks identical on both. On its own that
 *    gradient says nothing, and a screen full of them reads as *broken* rather
 *    than as *unillustrated*; the token's monogram over it makes each tile
 *    identifiable and obviously deliberate.
 *
 * Real artwork is never cropped (`contain` by default, so a wide banner keeps
 * its shape); the placeholder always covers, because it is a background rather
 * than a picture.
 */

/**
 * Up to four letters, matching the SDK's `assetMonogram` — the badge already
 * shown for the same assets on the wallet, sell and buy-review screens, so one
 * asset reads the same across the app. Ordinals and Kontor NFTs are named by
 * number/id, which still discriminates better than an empty square.
 */
function monogram(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, "");
  return (cleaned.slice(0, 4) || "?").toUpperCase();
}

/**
 * True for the tokens {@link TokenImage} draws itself instead of fetching. The
 * API reports these as placeholder-imaged, so a caller that styles the
 * placeholder differently (the detail hero drops its inset for it) needs to
 * know that this one is real artwork after all.
 */
export function tokenHasBrandMark(ref: TokenRef | undefined): boolean {
  return ref?.protocol === "counterparty" && ref.id === "XCP";
}

/**
 * Counterparty (XCP) brand mark — the same artwork as the SDK's internal
 * `XcpIcon`, which this screen cannot import (it is not on the package's public
 * surface). Sized by its container rather than a pixel prop, so it works in
 * both the 44px search thumbnail and the full-width detail panel.
 */
function XcpMark() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
      <Circle cx="16" cy="16" r="16" fill="#EC1550" />
      <G translateX={4} translateY={4} scale={0.75}>
        <Path
          d="M30 17.0643L25.9247 21.2926H22.0528C21.8426 21.293 21.6412 21.3798 21.4925 21.5339C21.3439 21.688 21.2602 21.8969 21.2598 22.1148V24.5245C21.2577 24.6514 21.2075 24.7724 21.1202 24.8613C21.0328 24.9503 20.9152 25.0001 20.7928 25H17.8365C17.7752 25 17.7144 24.9875 17.6577 24.9632C17.6011 24.9389 17.5496 24.9032 17.5062 24.8582C17.4628 24.8133 17.4284 24.7599 17.405 24.7011C17.3815 24.6423 17.3694 24.5793 17.3695 24.5157V18.662L19.7895 16.1529C19.8777 16.0668 19.9946 16.0196 20.1157 16.0212C20.2368 16.0228 20.3526 16.0731 20.4386 16.1616L21.5068 17.2691H24.3068L26.1128 15.3979V12.9415L24.2625 11.0146H21.7733L11.8776 21.275H6.1104L2 17.0161V11.2692L6.11474 7.0029H11.7392L14.1776 9.53103C14.2611 9.62136 14.3078 9.74165 14.3078 9.86679C14.3078 9.99193 14.2611 10.1122 14.1776 10.2025L12.1048 12.3445C12.0254 12.4395 11.9129 12.4979 11.792 12.507C11.6711 12.516 11.5517 12.475 11.4599 12.3929C11.4486 12.3826 11.4374 12.371 11.4261 12.3607L10.1336 11.0252H7.72054L5.87912 12.9342V15.354L7.7148 17.2604H10.2704L20.1677 7H25.87L30 11.2823V17.0643Z"
          fill="white"
        />
      </G>
    </Svg>
  );
}

export function TokenImage({
  uri,
  isPlaceholder,
  name,
  token,
  style,
  imageStyle,
  monogramSize = 16,
  resizeMode = "contain",
}: {
  /** Never empty — the API substitutes a placeholder rather than returning null. */
  uri: string;
  isPlaceholder: boolean;
  /** Seeds the monogram; ignored when real artwork loads. */
  name: string;
  /** Identifies the tokens that render a brand mark instead of `uri`. */
  token?: TokenRef;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  monogramSize?: number;
  resizeMode?: "cover" | "contain";
}) {
  // Track the URL that failed rather than a bare boolean, so a corrected or
  // refreshed `uri` re-attempts instead of sticking on the monogram.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const broken = failedUrl === uri;

  const brandMark = tokenHasBrandMark(token);
  // Query strings are ordinary on a proxied media URL, so match the extension
  // on the path alone.
  const isSvg = /\.svg(?:[?#]|$)/i.test(uri);
  // A dead URL is no different from no URL as far as this screen is concerned.
  const showMonogram = !brandMark && (isPlaceholder || broken);

  return (
    <View style={[styles.frame, style]}>
      {brandMark ? (
        <XcpMark />
      ) : broken ? null : isSvg ? (
        <SvgUri
          uri={uri}
          width="100%"
          height="100%"
          onError={() => setFailedUrl(uri)}
        />
      ) : (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill as ImageStyle, imageStyle]}
          resizeMode={isPlaceholder ? "cover" : resizeMode}
          onError={() => setFailedUrl(uri)}
        />
      )}
      {showMonogram && (
        <Text
          style={[
            styles.monogram,
            { fontSize: monogramSize, lineHeight: monogramSize * 1.2 },
          ]}
          numberOfLines={1}
        >
          {monogram(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    // Shows through only while the image loads, or behind a monogram whose
    // image 404'd — the placeholders themselves are opaque.
    backgroundColor: colors.surfaceHover,
  },
  // Dark ink: the four generated placeholders are all light pastels, so a
  // foreground-coloured monogram would vanish into them.
  monogram: {
    color: "rgba(11, 11, 21, 0.55)",
    fontFamily: fonts.sansBold,
    letterSpacing: 1,
  },
});
