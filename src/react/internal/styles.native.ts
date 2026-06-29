import { Platform, StyleSheet } from "react-native";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";

export const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

/**
 * Shared StyleSheet pieces (card root, inputs, buttons, summary rows) used by
 * every native component. Each component composes these with its own bits.
 */
export function commonSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.md,
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.lg,
    },
    // Chrome-less content stack for panels that live inside a Modal (the Modal
    // owns the card surface). Mirrors `panelBody` in styles.web.ts.
    panelBody: {
      gap: theme.spacing.md,
    },
    label: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    input: {
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
      fontSize: theme.typography.fontSizeBase,
    },
    button: {
      padding: theme.spacing.md,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: {
      color: theme.colors.primaryForeground,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "600",
    },
    buttonSecondary: {
      padding: theme.spacing.md,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
      alignItems: "center",
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "500",
    },
    actions: { flexDirection: "row", gap: theme.spacing.sm },
    summaryStack: { gap: theme.spacing.sm },
    flex1: { flex: 1 },
    summaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
    summaryLabel: { color: theme.colors.textMuted },
    summaryValue: { color: theme.colors.text, fontWeight: "600" },
    error: {
      color: theme.colors.error,
      fontSize: theme.typography.fontSizeSm,
    },
    muted: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
    },
    swapItemCard: {
      // Borderless, transparent tile (Horizon Market style): artwork panel +
      // text below, no card chrome.
      padding: 0,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      gap: theme.spacing.xs,
    },
    swapItemPlaceholder: {
      // Transparent: the surrounding imageGridPanel provides the dark panel bg.
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    swapItemName: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "500" as const,
    },
    swapToolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: theme.spacing.sm,
    },
    filterTabActive: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radii.sm,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.primary,
    },
    filterTabInactive: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      backgroundColor: "transparent",
      borderRadius: theme.radii.sm,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    filterTabTextActive: {
      color: theme.colors.primaryForeground,
      fontSize: theme.typography.fontSizeSm,
      fontWeight: "600" as const,
    },
    filterTabTextInactive: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
    },
    // Underline "tab" for the metaprotocol filter (All / Counterparty / …),
    // mirroring the Horizon Market token-explorer tabs.
    metaTabActive: {
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
      backgroundColor: "transparent",
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.primary,
    },
    metaTabInactive: {
      paddingHorizontal: theme.spacing.sm,
      paddingBottom: theme.spacing.sm,
      backgroundColor: "transparent",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    metaTabTextActive: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "700" as const,
    },
    metaTabTextInactive: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "700" as const,
    },
  });
}

export type CommonSheet = ReturnType<typeof commonSheet>;

const commonSheetCache = new WeakMap<ResolvedTheme, CommonSheet>();

/**
 * Returns the shared StyleSheet for the active theme, memoized across all
 * components by theme identity (the provider already memoizes `theme`).
 */
export function useCommonSheet(): CommonSheet {
  const theme = useTheme();
  let sheet = commonSheetCache.get(theme);
  if (!sheet) {
    sheet = commonSheet(theme);
    commonSheetCache.set(theme, sheet);
  }
  return sheet;
}
