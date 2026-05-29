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
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: webTokens.spacingMd,
};

export const swapListColumn: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
};

export const swapItemGrid: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingXs,
  padding: webTokens.spacingSm,
  background: webTokens.background,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
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
  objectFit: "cover",
  borderRadius: webTokens.radiusSm,
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
  background: webTokens.surface,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: webTokens.textMuted,
  fontSize: webTokens.fontSizeLg,
  fontWeight: 600,
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
