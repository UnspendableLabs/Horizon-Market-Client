import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import { Modal } from "../components/Modal.native.js";

export interface DropdownOption<T> {
  value: T;
  label: string;
}

export interface DropdownProps<T> {
  /** Currently selected value; matched against each option's `value`. */
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  /** Heading shown above the option list in the picker sheet. */
  title?: string;
  /** Fallback label shown in the trigger when no option matches `value`. */
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.sm,
    },
    triggerText: {
      flexShrink: 1,
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "500",
    },
    chevron: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.fontSizeSm,
    },
    options: {
      gap: theme.spacing.xs,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radii.sm,
    },
    optionActive: {
      backgroundColor: theme.colors.primary,
    },
    optionText: {
      color: theme.colors.text,
      fontSize: theme.typography.fontSizeBase,
    },
    optionTextActive: {
      color: theme.colors.primaryForeground,
      fontWeight: "600",
    },
    check: {
      color: theme.colors.primaryForeground,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "700",
    },
  });
}

/**
 * Compact select control for native: a bordered trigger showing the active
 * option's label + a chevron that opens the shared {@link Modal} as an option
 * picker. React Native has no native `<select>`, so SwapList uses this to fit the
 * asset-type filter and the sort control side by side on one toolbar row (the web
 * app uses tabs + a `<select>`).
 */
export function Dropdown<T>({
  value,
  options,
  onChange,
  title,
  placeholder,
  style,
}: DropdownProps<T>) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const [open, setOpen] = useState(false);
  // Object.is so a `null` value (e.g. the "All" filter) matches its option.
  const selected = options.find((o) => Object.is(o.value, value));

  return (
    <>
      <Pressable
        style={[sheet.trigger, style]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Text numberOfLines={1} style={sheet.triggerText}>
          {selected?.label ?? placeholder ?? ""}
        </Text>
        <Text style={sheet.chevron}>▾</Text>
      </Pressable>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <View style={sheet.options}>
          {options.map((opt) => {
            const active = Object.is(opt.value, value);
            return (
              <Pressable
                key={opt.label}
                onPress={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={[sheet.option, active && sheet.optionActive]}
                accessibilityRole="button"
              >
                <Text
                  style={[sheet.optionText, active && sheet.optionTextActive]}
                >
                  {opt.label}
                </Text>
                {active && <Text style={sheet.check}>✓</Text>}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}
