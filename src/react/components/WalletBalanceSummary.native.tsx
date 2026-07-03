import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../hooks/useTheme.js";
import type { ResolvedTheme } from "../theme.js";
import {
  TokenMark,
  useWalletTokenSummary,
  type TokenLine,
} from "../internal/walletBalances.native.js";

export interface WalletBalanceSummaryStyles {
  root?: StyleProp<ViewStyle>;
  header?: StyleProp<TextStyle>;
  grid?: StyleProp<ViewStyle>;
  cell?: StyleProp<ViewStyle>;
  showAll?: StyleProp<TextStyle>;
}

export interface WalletBalanceSummaryProps {
  /** Invoked by the "Show all" button — e.g. navigate to the wallet screen. */
  onShowAll?: () => void;
  /** Label for the "show all" affordance. */
  showAllLabel?: string;
  style?: StyleProp<ViewStyle>;
  styles?: WalletBalanceSummaryStyles;
}

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    root: { gap: theme.spacing.sm },
    header: {
      fontSize: theme.typography.fontSizeSm,
      fontWeight: "600",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: theme.colors.textMuted,
    },
    grid: { flexDirection: "row", flexWrap: "wrap" },
    // Two columns: each cell is half-width.
    cell: {
      width: "50%",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: 6,
    },
    amount: {
      flexShrink: 1,
      fontSize: theme.typography.fontSizeBase,
      fontWeight: "600",
      color: theme.colors.text,
    },
    unit: { color: theme.colors.textMuted, fontWeight: "500" },
    showAll: {
      alignSelf: "flex-start",
      paddingVertical: 2,
      color: theme.colors.primary,
      fontSize: theme.typography.fontSizeSm,
      fontWeight: "600",
    },
  });
}

function BalanceCell({
  line,
  sheet,
  styleProp,
}: {
  line: TokenLine;
  sheet: ReturnType<typeof createSheet>;
  styleProp?: StyleProp<ViewStyle>;
}) {
  const amount = line.amount ?? "…";
  return (
    <View style={[sheet.cell, styleProp]}>
      <TokenMark line={line} size={22} />
      <Text style={sheet.amount} numberOfLines={1}>
        {amount} <Text style={sheet.unit}>{line.symbol}</Text>
      </Text>
    </View>
  );
}

/**
 * Compact 2-column overview of the wallet's four headline balances
 * (BTC / XCP / KOR / ZELD — always all four, "0" when unheld), with an optional
 * "Show all" affordance. Designed to sit inside the wallet menu / modal.
 */
export function WalletBalanceSummary({
  onShowAll,
  showAllLabel = "Show all →",
  style,
  styles: stylesProp,
}: WalletBalanceSummaryProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  const { tokens } = useWalletTokenSummary();

  return (
    <View style={[sheet.root, style, stylesProp?.root]}>
      <Text style={[sheet.header, stylesProp?.header]}>Balances</Text>
      <View style={[sheet.grid, stylesProp?.grid]}>
        {tokens.map((line) => (
          <BalanceCell
            key={line.symbol}
            line={line}
            sheet={sheet}
            styleProp={stylesProp?.cell}
          />
        ))}
      </View>
      {onShowAll ? (
        <Pressable onPress={onShowAll}>
          <Text style={[sheet.showAll, stylesProp?.showAll]}>{showAllLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
