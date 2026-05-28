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

export function withDisabled(
  base: CSSProperties,
  disabled: boolean,
): CSSProperties {
  return disabled
    ? { ...base, opacity: 0.6, cursor: "not-allowed" }
    : base;
}
