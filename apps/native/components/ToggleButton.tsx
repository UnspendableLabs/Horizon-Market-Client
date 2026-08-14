/**
 * The app's pill toggle — one segment of a small segmented control.
 *
 * Lifted out of the Token Explorer, where it started, once the Create screen
 * needed the same control for its protocol and fee-rate rows. Wrap a row of
 * these in {@link toggleGroupStyle} to get the bordered track they sit in.
 */
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

export function ToggleButton({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
    >
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

/** The track a row of {@link ToggleButton}s sits in. */
export const toggleGroupStyle = {
  flexDirection: "row",
  alignSelf: "flex-start",
  padding: 3,
  gap: 2,
  borderRadius: radii.full,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
} as const;

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radii.full,
  },
  buttonActive: { backgroundColor: colors.surfaceActive },
  buttonDisabled: { opacity: 0.5 },
  text: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  textActive: { color: colors.foreground },
});
