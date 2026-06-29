import type { CSSProperties } from "react";

export interface HorizonMarketThemeColors {
  primary?: string;
  primaryForeground?: string;
  background?: string;
  /**
   * Elevated background used for floating surfaces (modals). On the web this is
   * the lighter stop of the modal's diagonal gradient; on native it's the modal
   * card's solid fill. Defaults to a value close to `background`, so unset
   * themes get a near-flat surface rather than a jarring gradient.
   */
  backgroundElevated?: string;
  surface?: string;
  border?: string;
  text?: string;
  textMuted?: string;
  success?: string;
  error?: string;
  pending?: string;
}

export interface HorizonMarketThemeTypography {
  fontFamily?: string;
  fontSizeSm?: number;
  fontSizeBase?: number;
  fontSizeLg?: number;
}

export interface HorizonMarketThemeSpacing {
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
}

export interface HorizonMarketThemeRadii {
  sm?: number;
  md?: number;
  lg?: number;
}

export interface HorizonMarketTheme {
  colors?: HorizonMarketThemeColors;
  typography?: HorizonMarketThemeTypography;
  spacing?: HorizonMarketThemeSpacing;
  radii?: HorizonMarketThemeRadii;
  borderWidth?: number;
}

export interface ResolvedTheme {
  colors: Required<HorizonMarketThemeColors>;
  typography: Required<Omit<HorizonMarketThemeTypography, "fontFamily">> & {
    fontFamily: string | undefined;
  };
  spacing: Required<HorizonMarketThemeSpacing>;
  radii: Required<HorizonMarketThemeRadii>;
  borderWidth: number;
}

export const defaultTheme: ResolvedTheme = {
  colors: {
    primary: "#3b82f6",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    backgroundElevated: "#f9fafb",
    surface: "#f9fafb",
    border: "#e5e7eb",
    text: "#111827",
    textMuted: "#6b7280",
    success: "#22c55e",
    error: "#ef4444",
    pending: "#f59e0b",
  },
  typography: {
    fontFamily: undefined,
    fontSizeSm: 12,
    fontSizeBase: 14,
    fontSizeLg: 16,
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radii: { sm: 4, md: 8, lg: 12 },
  borderWidth: 1,
};

export function resolveTheme(t?: HorizonMarketTheme): ResolvedTheme {
  return {
    colors: { ...defaultTheme.colors, ...(t?.colors ?? {}) },
    typography: { ...defaultTheme.typography, ...(t?.typography ?? {}) },
    spacing: { ...defaultTheme.spacing, ...(t?.spacing ?? {}) },
    radii: { ...defaultTheme.radii, ...(t?.radii ?? {}) },
    borderWidth: t?.borderWidth ?? defaultTheme.borderWidth,
  };
}

/**
 * Convert a resolved theme to CSS custom properties.
 * Web components use `var(--hm-primary, var(--primary, fallback))` — when the
 * consumer is on shadcn/ui, the design system variables are picked up
 * automatically; otherwise these `--hm-*` defaults apply.
 */
export function themeToCssVars(t: ResolvedTheme): CSSProperties {
  const vars: Record<string, string | number | undefined> = {
    "--hm-primary": t.colors.primary,
    "--hm-primary-foreground": t.colors.primaryForeground,
    "--hm-background": t.colors.background,
    "--hm-background-elevated": t.colors.backgroundElevated,
    "--hm-surface": t.colors.surface,
    "--hm-border": t.colors.border,
    "--hm-text": t.colors.text,
    "--hm-text-muted": t.colors.textMuted,
    "--hm-success": t.colors.success,
    "--hm-error": t.colors.error,
    "--hm-pending": t.colors.pending,
    "--hm-font-family": t.typography.fontFamily,
    "--hm-font-size-sm": `${t.typography.fontSizeSm}px`,
    "--hm-font-size-base": `${t.typography.fontSizeBase}px`,
    "--hm-font-size-lg": `${t.typography.fontSizeLg}px`,
    "--hm-spacing-xs": `${t.spacing.xs}px`,
    "--hm-spacing-sm": `${t.spacing.sm}px`,
    "--hm-spacing-md": `${t.spacing.md}px`,
    "--hm-spacing-lg": `${t.spacing.lg}px`,
    "--hm-radius-sm": `${t.radii.sm}px`,
    "--hm-radius-md": `${t.radii.md}px`,
    "--hm-radius-lg": `${t.radii.lg}px`,
    "--hm-border-width": `${t.borderWidth}px`,
  };
  return vars as CSSProperties;
}

/**
 * Web token strings — each token uses the shadcn/ui design variable when
 * present, falls back to the `--hm-*` override, and finally to the default.
 */
export const webTokens = {
  primary: "var(--hm-primary, var(--primary, #3b82f6))",
  primaryForeground:
    "var(--hm-primary-foreground, var(--primary-foreground, #ffffff))",
  background: "var(--hm-background, var(--background, #ffffff))",
  backgroundElevated:
    "var(--hm-background-elevated, var(--card, #f9fafb))",
  surface: "var(--hm-surface, var(--card, #f9fafb))",
  border: "var(--hm-border, var(--border, #e5e7eb))",
  text: "var(--hm-text, var(--foreground, #111827))",
  textMuted: "var(--hm-text-muted, var(--muted-foreground, #6b7280))",
  success: "var(--hm-success, #22c55e)",
  error: "var(--hm-error, var(--destructive, #ef4444))",
  pending: "var(--hm-pending, #f59e0b)",
  fontFamily: "var(--hm-font-family, inherit)",
  fontSizeSm: "var(--hm-font-size-sm, 12px)",
  fontSizeBase: "var(--hm-font-size-base, 14px)",
  fontSizeLg: "var(--hm-font-size-lg, 16px)",
  spacingXs: "var(--hm-spacing-xs, 4px)",
  spacingSm: "var(--hm-spacing-sm, 8px)",
  spacingMd: "var(--hm-spacing-md, 12px)",
  spacingLg: "var(--hm-spacing-lg, 16px)",
  radiusSm: "var(--hm-radius-sm, 4px)",
  radiusMd: "var(--hm-radius-md, 8px)",
  radiusLg: "var(--hm-radius-lg, 12px)",
  borderWidth: "var(--hm-border-width, 1px)",
} as const;
