import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { AssetOption } from "../hooks/useAssets.js";

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

/** Short label + background color for the placeholder monogram of an asset. */
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

/**
 * Asset thumbnail. The colored monogram badge is always rendered as the base
 * layer, with the real artwork (`imageUrl`, from the Horizon Market asset-image
 * endpoint) overlaid on top once it loads — so a list of assets shows instantly
 * and never blanks while thumbnails stream in. `radius` overrides the corner
 * rounding (pass `size / 2` for a circle). On a load error the image is dropped
 * and the badge shows through.
 */
export function AssetAvatar({
  asset,
  imageUrl,
  size = 56,
  radius,
}: {
  asset: AssetOption;
  imageUrl?: string | null;
  size?: number;
  radius?: number;
}) {
  // Track the failed URL (not a bare boolean) so switching assets re-attempts
  // the new image instead of staying on the fallback.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const borderRadius = radius ?? Math.round(size / 4);
  const badge = avatarBadge(asset);
  const showImage = Boolean(imageUrl) && failedUrl !== imageUrl;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: badge.bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontWeight: "700",
          fontSize: Math.max(10, Math.round(size / 4.2)),
        }}
      >
        {badge.label}
      </Text>
      {showImage ? (
        <Image
          source={{ uri: imageUrl as string }}
          onError={() => setFailedUrl(imageUrl ?? null)}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
        />
      ) : null}
    </View>
  );
}
