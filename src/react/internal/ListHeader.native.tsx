import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { formatRelativeTime } from "./format.js";

function createSheet(theme: ResolvedTheme) {
  return StyleSheet.create({
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      flexWrap: "wrap",
    },
    titleText: {
      fontSize: theme.typography.fontSizeLg,
      fontWeight: "700",
      color: theme.colors.text,
    },
    headerMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    updated: {
      fontSize: theme.typography.fontSizeSm,
      color: theme.colors.textMuted,
    },
    refreshButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radii.md,
      borderWidth: theme.borderWidth,
      borderColor: theme.colors.border,
    },
    refreshText: { fontSize: 12, color: theme.colors.text, fontWeight: "600" },
    disabled: { opacity: 0.5 },
  });
}

/**
 * The self-ageing "Updated …" text. Holds its OWN 15s clock so ageing the relative
 * time (e.g. "just now" → "1 min ago", no re-fetch) re-renders only this <Text> —
 * not the parent list, whose grid/rows would otherwise reconcile every tick, even
 * while its tab is off-screen but still mounted. Ticks only while mounted.
 */
function UpdatedLabel({
  lastFetchedAt,
  style,
}: {
  lastFetchedAt: Parameters<typeof formatRelativeTime>[0];
  style?: StyleProp<TextStyle>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={style}>Updated {formatRelativeTime(lastFetchedAt, now)}</Text>
  );
}

export interface ListHeaderProps {
  /**
   * Left-aligned heading. A bare string is wrapped in a <Text> (a raw string would
   * crash RN — "Text strings must be rendered within a <Text>"); any other node
   * renders as-is, so a caller can pass a pre-styled <Text> to match its screen.
   */
  title?: ReactNode;
  /** Last successful fetch — aged live in the "Updated …" label. */
  lastFetchedAt: Parameters<typeof formatRelativeTime>[0];
  /** True while a fetch is in flight — disables the button and shows "Refreshing…". */
  busy: boolean;
  onRefresh: () => void;
  /** Optional override for the header row container. */
  style?: StyleProp<ViewStyle>;
  /** Optional override for the "Refresh" button. */
  refreshStyle?: StyleProp<ViewStyle>;
}

/**
 * Shared list header — title on the left, a self-ageing "Updated …" label and a
 * "Refresh" button pinned right. Used by both {@link SwapList} and
 * {@link WalletBalances} so the two list screens stay visually identical and the
 * header (styles + the ticking-label behaviour) lives in exactly one place.
 */
export function ListHeader({
  title,
  lastFetchedAt,
  busy,
  onRefresh,
  style,
  refreshStyle,
}: ListHeaderProps) {
  const theme = useTheme();
  const sheet = useMemo(() => createSheet(theme), [theme]);
  return (
    <View style={[sheet.headerRow, style]}>
      {typeof title === "string" ? (
        <Text style={sheet.titleText}>{title}</Text>
      ) : (
        title
      )}
      <View style={sheet.headerMeta}>
        <UpdatedLabel lastFetchedAt={lastFetchedAt} style={sheet.updated} />
        <Pressable
          onPress={onRefresh}
          disabled={busy}
          style={[sheet.refreshButton, busy && sheet.disabled, refreshStyle]}
          accessibilityRole="button"
        >
          <Text style={sheet.refreshText}>{busy ? "Refreshing…" : "Refresh"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
