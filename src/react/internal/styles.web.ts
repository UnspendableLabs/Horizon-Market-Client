import type { CSSProperties } from "react";
import { webTokens } from "../theme.js";

export const cardRoot: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingMd,
  padding: webTokens.spacingLg,
  background: webTokens.surface,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusLg,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

export const input: CSSProperties = {
  padding: webTokens.spacingSm,
  background: webTokens.background,
  color: webTokens.text,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  fontSize: webTokens.fontSizeBase,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const label: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingXs,
};

export const primaryButton: CSSProperties = {
  padding: webTokens.spacingMd,
  background: webTokens.primary,
  color: webTokens.primaryForeground,
  border: "none",
  borderRadius: webTokens.radiusMd,
  fontSize: webTokens.fontSizeBase,
  fontWeight: 600,
  cursor: "pointer",
};

export const secondaryButton: CSSProperties = {
  padding: webTokens.spacingMd,
  background: "transparent",
  color: webTokens.text,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
  fontSize: webTokens.fontSizeBase,
  fontWeight: 500,
  cursor: "pointer",
};

export const actionsRow: CSSProperties = {
  display: "flex",
  gap: webTokens.spacingSm,
};

export const summaryStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
};

export const summaryRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
  padding: webTokens.spacingSm,
  background: webTokens.background,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
};

export const errorText: CSSProperties = {
  color: webTokens.error,
  fontSize: webTokens.fontSizeSm,
};

export const mutedText: CSSProperties = {
  color: webTokens.textMuted,
  fontSize: webTokens.fontSizeSm,
};

export function withDisabled(
  base: CSSProperties,
  disabled: boolean,
): CSSProperties {
  return disabled
    ? { ...base, opacity: 0.6, cursor: "not-allowed" }
    : base;
}

export const swapListToolbar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  flexWrap: "wrap",
};

export const swapGrid: CSSProperties = {
  display: "grid",
  // ~5 tiles per row on a desktop-width container (wider min => fewer, larger
  // tiles), collapsing responsively on narrower screens.
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
  // Equal-height rows: every tile in the grid is the same height regardless of
  // how much text it carries (mirrors the Horizon Market home grid).
  gridAutoRows: "1fr",
  columnGap: 40,
  rowGap: 48,
};

export const swapListColumn: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
};

export const swapItemGrid: CSSProperties = {
  // Borderless, transparent tile (Horizon Market style): just the artwork panel
  // and the text below it, no card chrome. height:100% lets the tile fill its
  // equal-height grid row so the action button can pin to the bottom.
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  height: "100%",
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
};

export const swapItemList: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  padding: webTokens.spacingSm,
  background: webTokens.background,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
};

export const swapItemImageFull: CSSProperties = {
  width: "100%",
  aspectRatio: "1",
  // Show the full artwork on a subtle square panel (like the Horizon Market
  // home), square corners, no rounding. Padding insets the artwork from the
  // panel edges (object-fit:contain fits inside the padding box; the background
  // fills the whole border box).
  objectFit: "contain",
  // Dark panel behind the artwork, matching Horizon Market's `bg-transpBlack-33`.
  background: "rgba(0, 0, 0, 0.33)",
  borderRadius: 0,
  padding: 32,
  boxSizing: "border-box",
  display: "block",
};

export const swapItemImageSmall: CSSProperties = {
  width: 48,
  height: 48,
  objectFit: "cover",
  borderRadius: webTokens.radiusSm,
  flexShrink: 0,
  display: "block",
};

export const swapItemPlaceholder: CSSProperties = {
  width: "100%",
  aspectRatio: "1",
  background: "rgba(0, 0, 0, 0.33)",
  border: "none",
  borderRadius: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: webTokens.spacingSm,
  color: webTokens.textMuted,
};

export const noImageText: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
};

export const swapItemPlaceholderSmall: CSSProperties = {
  width: 48,
  height: 48,
  background: webTokens.surface,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: webTokens.textMuted,
  flexShrink: 0,
};

export const modalOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

export const modalClose: CSSProperties = {
  position: "absolute",
  top: webTokens.spacingSm,
  right: webTokens.spacingSm,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: webTokens.fontSizeLg,
  color: webTokens.textMuted,
  lineHeight: "1",
  padding: webTokens.spacingXs,
};

export function filterTab(active: boolean): CSSProperties {
  return {
    padding: `${webTokens.spacingXs} ${webTokens.spacingMd}`,
    background: active ? webTokens.primary : "transparent",
    color: active ? webTokens.primaryForeground : webTokens.textMuted,
    border: `${webTokens.borderWidth} solid ${active ? webTokens.primary : webTokens.border}`,
    borderRadius: webTokens.radiusSm,
    cursor: "pointer",
    fontSize: webTokens.fontSizeSm,
    fontWeight: active ? 600 : 400,
  };
}

/**
 * Underline "tab" used for the metaprotocol filter (All / Counterparty / …),
 * mirroring the Horizon Market token-explorer tabs: a bottom border that
 * lights up on the active tab, bold label, no pill chrome.
 */
export function metaTab(active: boolean): CSSProperties {
  return {
    padding: `0 ${webTokens.spacingSm} ${webTokens.spacingSm}`,
    background: "transparent",
    color: active ? webTokens.text : webTokens.textMuted,
    border: "none",
    borderBottom: `2px solid ${active ? webTokens.primary : "transparent"}`,
    borderRadius: 0,
    cursor: "pointer",
    fontSize: webTokens.fontSizeBase,
    fontWeight: 700,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
}

export const iconButton: CSSProperties = {
  padding: webTokens.spacingXs,
  background: "transparent",
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  cursor: "pointer",
  color: webTokens.text,
  fontSize: webTokens.fontSizeBase,
  lineHeight: "1",
};
