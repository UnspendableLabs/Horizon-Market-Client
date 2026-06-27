/**
 * Horizon Market brand tokens for React Native StyleSheet.
 * Mirror of the CSS custom properties used in the web app.
 */
export const colors = {
  background: "#0b0b15",
  backgroundSecondary: "#161624",
  foreground: "#fefbf9",
  primary: "#1ee7c5",
  primaryForeground: "#0b0b15",
  primarySecondary: "#9de7cf",
  purple: "#a689f6",
  yellow: "#fee79a",
  offWhite: "#dee4e8",

  surface: "rgba(254, 251, 249, 0.04)",
  surfaceHover: "rgba(254, 251, 249, 0.08)",
  surfaceActive: "rgba(254, 251, 249, 0.16)",
  muted: "rgba(254, 251, 249, 0.33)",
  mutedStrong: "rgba(254, 251, 249, 0.66)",
  border: "rgba(254, 251, 249, 0.16)",
  borderSubtle: "rgba(254, 251, 249, 0.08)",

  success: "#1ee7c5",
  error: "#f87171",
  warning: "#fbbf24",
} as const;

export const fonts = {
  sans: "Montserrat_400Regular",
  sansSemiBold: "Montserrat_600SemiBold",
  sansBold: "Montserrat_700Bold",
  mono: "Courier New",
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  full: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const HORIZON_THEME = {
  colors: {
    primary: colors.primary,
    primaryForeground: colors.primaryForeground,
    background: colors.background,
    surface: colors.surface,
    border: colors.border,
    text: colors.foreground,
    textMuted: colors.muted,
    success: colors.success,
    error: colors.error,
    pending: colors.warning,
  },
  typography: {
    fontFamily: fonts.sans,
  },
  // The SDK theme (and RN's borderRadius) take numeric radii, not CSS strings.
  radii: {
    sm: radii.sm,
    md: radii.md,
    lg: radii.lg,
  },
} as const;
