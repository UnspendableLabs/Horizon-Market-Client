import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useHorizonMarket,
  useTokenList,
  type BrowsableTokenProtocol,
  type TokenSummary,
} from "@unspendablelabs/horizon-market-client/react";
import { Header } from "../components/Header.js";
import { StandaloneTabBar } from "../components/TabBar.js";
import { TokenImage } from "../components/TokenImage.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import { tokenHref } from "../lib/token-links.js";
import { formatSatsAsBtc } from "../lib/token-format.js";

/**
 * Token Explorer — horizon.market's `/token-explorer`, as a phone screen.
 *
 * The Buy tab lists what is *for sale*; this lists what *exists*. One protocol
 * at a time, because three catalogues ordered by three unrelated things
 * (issuance height, inscription order, mint order) cannot be interleaved into a
 * list that pages coherently — so the tabs are the feed's identity, not a
 * filter over a merged one.
 *
 * Rows come back in the same shape the search screen renders, so a tile opens
 * the same token screen through the same route, and neither surface knows a
 * thing about any protocol's URL shape.
 *
 * A root-stack route reached from the header's hamburger, wearing the app's
 * normal chrome (Header above, StandaloneTabBar below) so every tab stays one
 * tap away.
 */

const PROTOCOL_TABS: { protocol: BrowsableTokenProtocol; label: string }[] = [
  { protocol: "counterparty", label: "Counterparty" },
  { protocol: "ordinals", label: "Ordinals" },
  { protocol: "kontor-nft", label: "Kontor" },
];

/** Two columns of square art is what fits a phone without shrinking the name. */
const COLUMNS = 2;

export default function TokenExplorerScreen() {
  const router = useRouter();
  const { kontorNetwork } = useHorizonMarket();
  // Kontor lives on signet only. Off it the endpoint 404s, so the tab is not
  // offered at all rather than shown as an empty (or erroring) list.
  const tabs = useMemo(
    () =>
      PROTOCOL_TABS.filter(
        (tab) => tab.protocol !== "kontor-nft" || kontorNetwork === "signet",
      ),
    [kontorNetwork],
  );

  const [picked, setPicked] = useState<BrowsableTokenProtocol>("counterparty");
  // Derived rather than corrected in an effect: a network switch that drops the
  // Kontor tab must not leave the feed pinned to a protocol this host doesn't
  // serve, and falling back in render means no frame ever shows that state.
  const protocol = tabs.some((tab) => tab.protocol === picked)
    ? picked
    : "counterparty";
  const [listedOnly, setListedOnly] = useState(false);

  const {
    tokens,
    total,
    source,
    loading,
    loadingMore,
    error,
    notAvailable,
    degraded,
    artworkPartial,
    hasMore,
    loadMore,
    refresh,
  } = useTokenList({ protocol, listedOnly });

  const open = useCallback(
    (token: TokenSummary) => {
      // `push`, not `navigate`: Back should return to the grid, at the row the
      // user was on, rather than to whichever tab they opened the explorer from.
      router.push(
        tokenHref({ protocol: token.protocol, id: token.id }, "token_explorer"),
      );
    },
    [router],
  );

  return (
    <View style={styles.screen}>
      <Header />

      <View style={styles.filters}>
        <View style={styles.tabs}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.protocol}
              onPress={() => setPicked(tab.protocol)}
              style={[styles.tab, protocol === tab.protocol && styles.tabActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: protocol === tab.protocol }}
            >
              <Text
                style={[
                  styles.tabText,
                  protocol === tab.protocol && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Listed / All, as on the website — but offered for every protocol,
            Kontor included: `listed_only` pages Horizon's own order book, which
            is protocol-agnostic. */}
        <View style={styles.toggle}>
          <ToggleButton
            label="Listed"
            active={listedOnly}
            onPress={() => setListedOnly(true)}
          />
          <ToggleButton
            label="All"
            active={!listedOnly}
            onPress={() => setListedOnly(false)}
          />
        </View>
      </View>

      <FlatList
        data={tokens}
        keyExtractor={(item) => item.canonicalId}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TokenCard token={item} onPress={() => open(item)} />
        )}
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          degraded ? (
            <Text style={styles.warning}>
              Some names or prices are missing on this page — an upstream
              didn&apos;t answer in time.
            </Text>
          ) : artworkPartial ? (
            // Not a warning: nothing failed. The server ran out of time
            // resolving artwork out of asset descriptions, and the resolutions
            // that missed the deadline finish into its cache — so a re-read
            // genuinely fixes it, which is why this is a button and not a banner.
            <Pressable onPress={refresh} accessibilityRole="button">
              <Text style={styles.hint}>
                Some artwork is still resolving — tap to reload.
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.notice}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : notAvailable ? (
              <Text style={styles.noticeText}>
                Kontor NFTs live on signet. Switch network in Settings to browse
                them.
              </Text>
            ) : error ? (
              <>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  onPress={refresh}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Try again</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.noticeText}>
                {listedOnly
                  ? "Nothing listed right now under this protocol."
                  : "Nothing to browse here yet."}
              </Text>
            )}
          </View>
        }
        ListFooterComponent={
          tokens.length > 0 ? (
            <View style={styles.footer}>
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.footerText}>
                  {hasMore
                    ? `${tokens.length} of ${total}`
                    : // A window is the edge of what is browsable, not the end
                      // of the protocol — say so, or "it stopped at 100" reads
                      // as a bug.
                      source === "recent_window"
                      ? `${tokens.length} most recent — search reaches the rest`
                      : `${total} token${total === 1 ? "" : "s"}`}
                </Text>
              )}
            </View>
          ) : null
        }
      />

      <StandaloneTabBar />
    </View>
  );
}

function ToggleButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.toggleButton, active && styles.toggleButtonActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TokenCard({
  token,
  onPress,
}: {
  token: TokenSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Open ${token.name}`}
    >
      <View style={styles.artPanel}>
        {/* `imageUrl` is never empty — an unillustrated token gets the same
            deterministic placeholder the detail screen and the website draw. */}
        <TokenImage
          uri={token.imageUrl}
          isPlaceholder={token.imageIsPlaceholder}
          name={token.name}
          token={{ protocol: token.protocol, id: token.id }}
          style={styles.art}
          resizeMode="cover"
          monogramSize={22}
        />
      </View>
      <View style={styles.cardText}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {token.name}
          </Text>
          {token.listed && <View style={styles.listedDot} />}
        </View>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {token.listed && token.floorPriceSats != null
            ? `${formatSatsAsBtc(token.floorPriceSats)} floor`
            : (token.collection?.name ?? token.subtitle ?? "Not listed")}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tabs: { flexDirection: "row", gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
  },
  tabActive: { backgroundColor: colors.surfaceHover },
  tabText: { fontSize: 13, color: colors.muted, fontFamily: fonts.sansSemiBold },
  tabTextActive: { color: colors.foreground },

  toggle: {
    flexDirection: "row",
    alignSelf: "flex-start",
    padding: 3,
    gap: 2,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggleButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radii.full,
  },
  toggleButtonActive: { backgroundColor: colors.surfaceActive },
  toggleText: { fontSize: 12, color: colors.muted, fontFamily: fonts.sansSemiBold },
  toggleTextActive: { color: colors.foreground },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  column: { gap: spacing.md, marginBottom: spacing.md },

  card: { flex: 1 / COLUMNS, gap: spacing.xs },
  artPanel: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radii.md,
    backgroundColor: "rgba(0, 0, 0, 0.33)",
    overflow: "hidden",
  },
  art: { width: "100%", height: "100%" },
  cardText: { gap: 2 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cardName: {
    flexShrink: 1,
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  listedDot: {
    width: 7,
    height: 7,
    borderRadius: radii.full,
    backgroundColor: colors.success,
  },
  cardMeta: { fontSize: 11, color: colors.muted, fontFamily: fonts.sans },

  notice: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  noticeText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
    lineHeight: 19,
  },
  errorText: { fontSize: 13, color: colors.error, fontFamily: fonts.sans },
  warning: {
    fontSize: 12,
    color: colors.warning,
    fontFamily: fonts.sans,
    paddingBottom: spacing.sm,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    paddingBottom: spacing.sm,
  },
  footer: { alignItems: "center", paddingVertical: spacing.md },
  footerText: { fontSize: 12, color: colors.muted, fontFamily: fonts.sans },

  secondaryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
});
