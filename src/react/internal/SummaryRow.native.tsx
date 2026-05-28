import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { CommonSheet } from "./styles.native.js";
import { MONO_FONT } from "./styles.native.js";

export interface SummaryRowProps {
  label: string;
  value: string;
  sheet: CommonSheet;
  mono?: boolean;
  rowStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function SummaryRow({
  label,
  value,
  sheet,
  mono,
  rowStyle,
  labelStyle,
  valueStyle,
}: SummaryRowProps) {
  return (
    <View style={[sheet.summaryRow, rowStyle]}>
      <Text style={[sheet.summaryLabel, labelStyle]}>{label}</Text>
      <Text
        style={[
          sheet.summaryValue,
          mono && { fontFamily: MONO_FONT },
          valueStyle,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
