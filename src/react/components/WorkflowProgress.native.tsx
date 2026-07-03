import { useMemo } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { WorkflowProgressEvent } from "../../types/index.js";
import { useTheme } from "../hooks/useTheme.js";
import { reduceSteps, stepVisual, type StepView } from "../internal/progress.js";
import type { ResolvedTheme } from "../theme.js";

export interface WorkflowProgressStyles {
  root?: StyleProp<ViewStyle>;
  step?: StyleProp<ViewStyle>;
  icon?: StyleProp<TextStyle>;
  label?: StyleProp<TextStyle>;
  successMessage?: StyleProp<TextStyle>;
  errorMessage?: StyleProp<TextStyle>;
}

export interface WorkflowProgressProps {
  steps: WorkflowProgressEvent[];
  totalSteps: number | null;
  status: "idle" | "loading" | "success" | "error";
  successMessage?: string;
  errorMessage?: string;
  style?: StyleProp<ViewStyle>;
  styles?: WorkflowProgressStyles;
}

const MAX_PENDING_STEPS = 10;

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: {
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.md,
    },
    header: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    success: {
      marginTop: theme.spacing.sm,
      color: theme.colors.success,
      fontWeight: "600",
    },
    error: {
      marginTop: theme.spacing.sm,
      color: theme.colors.error,
      fontWeight: "600",
    },
    stepRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    iconBox: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    iconText: { fontWeight: "700" },
    label: {
      fontSize: theme.typography.fontSizeBase,
      flexShrink: 1,
    },
  });
}

export function WorkflowProgress({
  steps,
  totalSteps,
  status,
  successMessage,
  errorMessage,
  style,
  styles: stylesProp,
}: WorkflowProgressProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const view = reduceSteps(steps);
  const showPending =
    totalSteps !== null && view.length < totalSteps && status === "loading";
  const remaining =
    totalSteps !== null
      ? Math.min(Math.max(0, totalSteps - view.length), MAX_PENDING_STEPS)
      : 0;

  return (
    <View style={[sheet.root, style, stylesProp?.root]}>
      {totalSteps !== null && (
        <Text style={sheet.header}>
          Step {Math.min(view.length, totalSteps)} of {totalSteps}
        </Text>
      )}
      {view.map((s) => (
        <Step key={s.key} step={s} theme={theme} sheet={sheet} stylesProp={stylesProp} />
      ))}
      {showPending &&
        Array.from({ length: remaining }).map((_, i) => (
          <Step
            key={`pending-${i}`}
            step={{
              key: `pending-${i}`,
              label: "Pending…",
              state: "pending",
            }}
            theme={theme}
            sheet={sheet}
            stylesProp={stylesProp}
          />
        ))}
      {status === "success" && successMessage && (
        <Text style={[sheet.success, stylesProp?.successMessage]}>
          ✅ {successMessage}
        </Text>
      )}
      {status === "error" && (
        <Text style={[sheet.error, stylesProp?.errorMessage]}>
          ✗ {errorMessage ?? "Workflow failed"}
        </Text>
      )}
    </View>
  );
}

function Step({
  step,
  theme,
  sheet,
  stylesProp,
}: {
  step: StepView;
  theme: ResolvedTheme;
  sheet: ReturnType<typeof createSheet>;
  stylesProp?: WorkflowProgressStyles;
}) {
  // Icon + colors come from the shared `stepVisual` mapping (see progress.ts) so
  // native and web never drift; we only translate the semantic keys to theme.
  const { icon, iconColorKey, labelColorKey } = stepVisual(step.state);
  const color = theme.colors[iconColorKey];
  const labelColor = theme.colors[labelColorKey];

  return (
    <View style={[sheet.stepRow, stylesProp?.step]}>
      <View style={sheet.iconBox}>
        {icon ? (
          <Text style={[sheet.iconText, { color }, stylesProp?.icon]}>
            {icon}
          </Text>
        ) : (
          <ActivityIndicator size="small" color={color} />
        )}
      </View>
      <Text style={[sheet.label, { color: labelColor }, stylesProp?.label]}>
        {step.label}
      </Text>
    </View>
  );
}
