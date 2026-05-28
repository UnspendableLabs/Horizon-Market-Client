import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { CommonSheet } from "./styles.native.js";

export interface ResultActionsProps {
  isError: boolean;
  onBack: () => void;
  onRetry: () => void;
  onComplete: () => void;
  completeLabel: string;
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
  sheet,
  styles,
}: ResultActionsProps) {
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
    </View>
  );
}
