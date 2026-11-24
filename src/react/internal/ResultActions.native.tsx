import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { CommonSheet } from "./styles.native.js";

export interface ResultActionsProps {
  isError: boolean;
  onBack: () => void;
  onRetry: () => void;
  onComplete: () => void;
  completeLabel: string;
  /** Optional dismiss action; when set, a "Close" button is shown on success. */
  onClose?: () => void;
  closeLabel?: string;
  /**
   * The failure is an uncertain Kontor publication: signed, handed to the
   * network, and maybe already on-chain. Back and Retry both lead to signing a
   * second one, so neither is offered — only {@link onCheckAgain}, when the
   * flow can re-check the same signed package, and a way out (`onClose`, else
   * `onComplete`).
   */
  unresolved?: boolean;
  /** Re-check the same signed package. Shown only when {@link unresolved}. */
  onCheckAgain?: () => void;
  /** A re-check is in flight: "Check again" is disabled. */
  checking?: boolean;
  sheet: CommonSheet;
  styles?: {
    button?: StyleProp<ViewStyle>;
    buttonText?: StyleProp<TextStyle>;
    buttonSecondary?: StyleProp<ViewStyle>;
    buttonSecondaryText?: StyleProp<TextStyle>;
  };
}

export function ResultActions({
  isError,
  onBack,
  onRetry,
  onComplete,
  completeLabel,
  onClose,
  closeLabel = "Close",
  unresolved = false,
  onCheckAgain,
  checking = false,
  sheet,
  styles,
}: ResultActionsProps) {
  if (isError && unresolved) {
    return (
      <View style={sheet.actions}>
        <Pressable
          onPress={onClose ?? onComplete}
          style={[sheet.buttonSecondary, sheet.flex1, styles?.buttonSecondary]}
        >
          <Text
            style={[sheet.buttonSecondaryText, styles?.buttonSecondaryText]}
          >
            {onClose ? closeLabel : completeLabel}
          </Text>
        </Pressable>
        {onCheckAgain && (
          <Pressable
            onPress={onCheckAgain}
            disabled={checking}
            style={[
              sheet.button,
              sheet.flex1,
              checking && sheet.buttonDisabled,
              styles?.button,
            ]}
          >
            <Text style={[sheet.buttonText, styles?.buttonText]}>
              {checking ? "Checking…" : "Check again"}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (isError) {
    return (
      <View style={sheet.actions}>
        <Pressable
          onPress={onBack}
          style={[sheet.buttonSecondary, sheet.flex1, styles?.buttonSecondary]}
        >
          <Text
            style={[sheet.buttonSecondaryText, styles?.buttonSecondaryText]}
          >
            Back
          </Text>
        </Pressable>
        <Pressable
          onPress={onRetry}
          style={[sheet.button, sheet.flex1, styles?.button]}
        >
          <Text style={[sheet.buttonText, styles?.buttonText]}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={sheet.actions}>
      <Pressable
        onPress={onComplete}
        style={[sheet.button, sheet.flex1, styles?.button]}
      >
        <Text style={[sheet.buttonText, styles?.buttonText]}>
          {completeLabel}
        </Text>
      </Pressable>
      {onClose && (
        <Pressable
          onPress={onClose}
          style={[sheet.buttonSecondary, sheet.flex1, styles?.buttonSecondary]}
        >
          <Text style={[sheet.buttonSecondaryText, styles?.buttonSecondaryText]}>
            {closeLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
