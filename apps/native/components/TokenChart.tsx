/**
 * The price series a token's `/chart` endpoint returns, drawn with
 * `react-native-svg` (already a dependency — the {@link Header} uses it).
 *
 * Deliberately hand-drawn rather than pulling in a charting library: the payload
 * is a flat list of `{ time, price }` and all this needs is a polyline, a fill
 * under it and two axis labels. A charting package would add a native dependency
 * and a theme to fight for a graph this simple.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";
import type {
  TokenChart as TokenChartData,
  TokenChartRange,
} from "@unspendablelabs/horizon-market-client/react";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import { formatSatsAsBtc, formatTimeAgo } from "../lib/token-format.js";

const HEIGHT = 180;
/** Drawn in an arbitrary user-space width; the SVG scales it to the screen. */
const WIDTH = 320;
const PADDING_Y = 12;

interface Geometry {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  min: number;
  max: number;
}

/**
 * Map the series into an SVG path.
 *
 * A flat series (every point at the same price) would divide by a zero range, so
 * it is drawn as a centre line rather than collapsing onto the top edge.
 */
function geometry(prices: number[]): Geometry | null {
  if (prices.length === 0) return null;

  // Folded rather than `Math.min(...prices)`: the series length is the server's
  // to choose, and a spread argument list is bounded by the JS call-stack.
  let min = prices[0]!;
  let max = prices[0]!;
  for (const price of prices) {
    if (price < min) min = price;
    if (price > max) max = price;
  }
  const span = max - min;
  const usableHeight = HEIGHT - PADDING_Y * 2;
  const step = prices.length > 1 ? WIDTH / (prices.length - 1) : 0;

  const points = prices.map((price, i) => {
    const x = prices.length > 1 ? i * step : WIDTH / 2;
    const y =
      span === 0
        ? HEIGHT / 2
        : PADDING_Y + usableHeight - ((price - min) / span) * usableHeight;
    return { x, y };
  });

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x.toFixed(2)} ${HEIGHT} L${first.x.toFixed(2)} ${HEIGHT} Z`;

  return { line, area, lastX: last.x, lastY: last.y, min, max };
}

export function TokenChart({
  chart,
  loading,
  error,
  range,
  ranges,
  onRangeChange,
}: {
  chart: TokenChartData | null;
  loading: boolean;
  error: string | null;
  range: TokenChartRange;
  ranges: TokenChartRange[];
  onRangeChange: (range: TokenChartRange) => void;
}) {
  const prices = useMemo(
    () => (chart?.points ?? []).map((point) => point.price),
    [chart],
  );
  const geo = useMemo(() => geometry(prices), [prices]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.ranges}>
        {ranges.map((option) => {
          const active = option === range;
          return (
            <Pressable
              key={option}
              onPress={() => onRangeChange(option)}
              style={[styles.rangeButton, active && styles.rangeButtonActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[styles.rangeText, active && styles.rangeTextActive]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text style={styles.notice}>{error}</Text>
      ) : geo ? (
        <>
          <View style={styles.plot}>
            {/* `viewBox` + no width/height: the SVG scales its user space to
                whatever width the row gets, so the graph is resolution- and
                device-independent without measuring the layout. */}
            <Svg
              width="100%"
              height={HEIGHT}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
            >
              <Path d={geo.area} fill={colors.primary} fillOpacity={0.12} />
              <Path
                d={geo.line}
                stroke={colors.primary}
                strokeWidth={2}
                fill="none"
                // Scaled non-uniformly by preserveAspectRatio="none"; without
                // this the stroke would be visibly thicker vertically.
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <Circle
                cx={geo.lastX}
                cy={geo.lastY}
                r={3}
                fill={colors.primary}
              />
            </Svg>
            <View style={styles.axis} pointerEvents="none">
              <Text style={styles.axisLabel}>{formatSatsAsBtc(geo.max)}</Text>
              <Text style={styles.axisLabel}>{formatSatsAsBtc(geo.min)}</Text>
            </View>
          </View>
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {chart?.tradeCount ?? 0} trade
              {chart?.tradeCount === 1 ? "" : "s"} · {chart?.intervalLabel} buckets
            </Text>
            {chart?.to && (
              <Text style={styles.footerText}>
                to {formatTimeAgo(chart.to)}
              </Text>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.notice}>
          {loading ? "Loading…" : "No trades in this range."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  ranges: { flexDirection: "row", gap: spacing.xs },
  rangeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  rangeText: {
    fontSize: 12,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },
  rangeTextActive: { color: colors.primaryForeground },
  plot: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  axis: {
    // RN 0.86 merged `absoluteFillObject` into `absoluteFill` (see BrandCover).
    ...StyleSheet.absoluteFill,
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  axisLabel: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
  footer: { flexDirection: "row", justifyContent: "space-between" },
  footerText: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.sans,
  },
  notice: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
});
