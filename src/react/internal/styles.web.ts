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

/**
 * Chrome-less content stack used by the panels that live inside a {@link Modal}
 * (LoginPanel / SellOrderForm / SwapConfirmation). The Modal now owns the card
 * surface (gradient background, padding, radius), so the panels just stack their
 * fields — no background, border, or padding of their own.
 */
export const panelBody: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingMd,
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

/** Bordered, padded panel used for each section of the sell review screen. */
export const reviewSection: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  padding: webTokens.spacingMd,
  background: webTokens.surface,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
};

/** Small muted heading at the top of each review section ("You're selling"). */
export const reviewSectionLabel: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
};

/** Compact bordered fee-rate selector shown top-right of "You'll pay to list". */
export const feeRateSelect: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  padding: "6px 10px",
  background: webTokens.background,
  color: webTokens.text,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  fontSize: webTokens.fontSizeSm,
  fontFamily: "inherit",
  cursor: "pointer",
} as CSSProperties;

/** Borderless full-width text button (the review's "Cancel"). */
export const textButton: CSSProperties = {
  padding: webTokens.spacingSm,
  background: "transparent",
  color: webTokens.textMuted,
  border: "none",
  borderRadius: webTokens.radiusMd,
  fontSize: webTokens.fontSizeBase,
  fontWeight: 500,
  cursor: "pointer",
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

export const swapItemGrid: CSSProperties = {
  // Borderless, transparent tile (Horizon Market style): just the artwork panel
  // and the text below it, no card chrome. height:100% lets the tile fill its
  // equal-height grid row so the action button can pin to the bottom.
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  height: "100%",
  // Allow the tile to shrink below its content's intrinsic width so the nowrap
  // title ellipsis engages and every grid track stays exactly equal — without
  // this a long title blows the tile past its 1fr share and squashes its
  // neighbour (most visible in the 2-up phone grid).
  minWidth: 0,
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
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

export const modalOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: webTokens.spacingMd,
  zIndex: 1000,
} as CSSProperties;

/**
 * Floating modal card (Horizon Market style): diagonal gradient fill, no border,
 * generous padding, large radius. Owns the visible surface; its children stack
 * directly on top (see {@link panelBody}).
 */
export const modalCard: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingLg,
  width: "100%",
  maxHeight: "90vh",
  overflowY: "auto",
  padding: 24,
  background: `linear-gradient(224deg, ${webTokens.background} 52.98%, ${webTokens.backgroundElevated} 81.99%)`,
  border: "none",
  borderRadius: webTokens.radiusLg,
  boxShadow: "0 24px 60px -12px rgba(0, 0, 0, 0.6)",
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

export const modalHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingMd,
};

export const modalTitle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
};

export const modalClose: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: 32,
  height: 32,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: webTokens.fontSizeLg,
  color: webTokens.text,
  lineHeight: "1",
  padding: 0,
  borderRadius: webTokens.radiusSm,
};

export function filterTab(active: boolean): CSSProperties {
  return {
    // Font size matches `input`; vertical padding is 1px shy of spacingSm so the
    // button lines up to the same height as the sort <select> to its left (the
    // native select renders ~2px taller for the same nominal padding).
    padding: `calc(${webTokens.spacingSm} - 1px) ${webTokens.spacingMd}`,
    background: active ? webTokens.primary : "transparent",
    color: active ? webTokens.primaryForeground : webTokens.textMuted,
    border: `${webTokens.borderWidth} solid ${active ? webTokens.primary : webTokens.border}`,
    borderRadius: webTokens.radiusSm,
    cursor: "pointer",
    fontSize: webTokens.fontSizeBase,
    fontWeight: active ? 600 : 400,
    boxSizing: "border-box",
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
