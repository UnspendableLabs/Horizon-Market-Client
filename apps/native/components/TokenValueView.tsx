/**
 * Renders one {@link TokenValue} — the typed, machine-readable value the tokens
 * API sends in place of a display string.
 *
 * This is what lets a token screen be protocol-blind: `stats` and `properties`
 * are ordered lists of labelled values, so the server can add a row for any
 * asset type and it appears here with no client change. The only thing this
 * component branches on is `value.type`, never on the protocol.
 */
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { TokenValue } from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  formatCount,
  formatDateTime,
  formatSatsAsBtc,
  stripHtml,
  truncateMiddle,
} from "../lib/token-format.js";

const TONE_COLORS = {
  neutral: colors.mutedStrong,
  positive: colors.success,
  warning: colors.warning,
  danger: colors.error,
} as const;

/** The value as text, formatted per its declared type. */
export function tokenValueText(value: TokenValue): string {
  const raw = value.value;
  if (raw === null || raw === undefined) return "—";

  switch (value.type) {
    case "sats":
      return typeof raw === "number" ? formatSatsAsBtc(raw) : String(raw);
    case "number": {
      if (typeof raw !== "number") return String(raw);
      const text = formatCount(raw);
      return value.unit ? `${text} ${value.unit}` : text;
    }
    case "datetime":
      return typeof raw === "string" ? formatDateTime(raw) : String(raw);
    case "boolean":
      return raw ? "Yes" : "No";
    case "address":
    case "txid":
      return typeof raw === "string" ? truncateMiddle(raw) : String(raw);
    case "json":
      return JSON.stringify(raw);
    default: {
      // A free-form `text` row (a Counterparty description) frequently carries
      // raw HTML, which a <Text> renders verbatim. Fall back to the raw string
      // if stripping leaves nothing, so a value made only of markup still shows
      // something rather than vanishing.
      const text = typeof raw === "string" ? (stripHtml(raw) ?? raw) : String(raw);
      return value.unit ? `${text} ${value.unit}` : text;
    }
  }
}

export function TokenValueView({
  value,
  align = "right",
}: {
  value: TokenValue;
  align?: "left" | "right";
}) {
  const text = tokenValueText(value);
  const alignment = align === "right" ? ("right" as const) : ("left" as const);

  if (value.type === "badge") {
    return (
      <View style={styles.badge}>
        <Text
          style={[
            styles.badgeText,
            { color: TONE_COLORS[value.tone ?? "neutral"] },
          ]}
        >
          {text}
        </Text>
      </View>
    );
  }

  const body = (
    <>
      <Text
        style={[
          styles.value,
          { textAlign: alignment },
          // Identifiers read better monospaced, and the server tells us which
          // values are identifiers.
          (value.type === "address" || value.type === "txid") && styles.mono,
          value.url != null && styles.link,
        ]}
        numberOfLines={value.type === "json" ? 4 : 2}
      >
        {text}
        {value.url != null ? " ↗" : ""}
      </Text>
      {value.subLabel && <Text style={[styles.subLabel, { textAlign: alignment }]}>{value.subLabel}</Text>}
    </>
  );

  if (!value.url) return <View style={styles.block}>{body}</View>;

  return (
    <Pressable
      onPress={() => void Linking.openURL(value.url!)}
      hitSlop={6}
      accessibilityRole="link"
      style={styles.block}
    >
      {body}
    </Pressable>
  );
}

/** A label/value row — the shape both `stats` and `properties` render as. */
export function TokenValueRow({
  label,
  value,
}: {
  label: string;
  value: TokenValue;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.rowValue}>
        <TokenValueView value={value} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexShrink: 1 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowValue: { flexShrink: 1, maxWidth: "62%" },
  label: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    flexShrink: 1,
  },
  value: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  link: { color: colors.primary },
  subLabel: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.sans,
    marginTop: 2,
  },
  badge: {
    alignSelf: "flex-end",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceHover,
  },
  badgeText: { fontSize: 12, fontFamily: fonts.sansSemiBold },
});
