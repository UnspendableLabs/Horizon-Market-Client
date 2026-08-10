import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useTokenSearch,
  type TokenSummary,
} from "@unspendablelabs/horizon-market-client/react";
import { Header } from "../components/Header.js";
import { StandaloneTabBar } from "../components/TabBar.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import { tokenHref } from "../lib/token-links.js";
import { formatSatsAsBtc } from "../lib/token-format.js";
import { trackTokenSearchResultOpened } from "../lib/analytics/events.js";

/**
 * Token search — one query across all five asset types.
 *
 * A root-stack route pushed over the tab pager from the {@link Header}'s
 * magnifier, wearing the same chrome as /profile. Every result carries the
 * identity the token screen needs, so a tap goes straight there with no
 * knowledge of any protocol's URL shape.
 *
 * Two limits are the server's, and are stated on screen rather than left to look
 * like a bug: a Kontor NFT is findable by its `nft_id` only (its display name
 * lives on the Kontor Portal and nothing indexes it), and an inscription by
 * number or id — neither has a searchable on-chain name.
 */
export default function SearchScreen() {
  const router = useRouter();
  const { query, setQuery, results, loading, error, truncated, degraded } =
    useTokenSearch();

  const open = useCallback(
    (token: TokenSummary, index: number) => {
      trackTokenSearchResultOpened({
        protocol: token.protocol,
        position: index,
        queryLength: query.trim().length,
      });
      // `push`, not `navigate`: Back should return to the results, not to
      // whichever tab the user opened the search from.
      router.push(tokenHref(token, "search"));
    },
    [router, query],
  );

  const trimmed = query.trim();

  return (
    <View style={styles.screen}>
      <Header />

      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tokens, inscriptions, NFTs…"
          placeholderTextColor={colors.muted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
          accessibilityLabel="Search tokens"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={8}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.canonicalId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <ResultRow token={item} onPress={() => open(item, index)} />
        )}
        ListHeaderComponent={
          degraded ? (
            <Text style={styles.warning}>
              Some sources didn&apos;t respond — results may be incomplete.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.notice}>
            {trimmed === "" ? (
              <Text style={styles.noticeText}>
                Search by asset name, inscription number or id, or a Kontor NFT
                id. Ordinals and Kontor NFTs have no on-chain name, so a word
                query won&apos;t find them.
              </Text>
            ) : loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <Text style={styles.noticeText}>
                No tokens match “{trimmed}”.
              </Text>
            )}
          </View>
        }
        ListFooterComponent={
          results.length > 0 ? (
            <Text style={styles.footer}>
              {loading
                ? "Searching…"
                : truncated
                  ? "More matches exist — keep typing to narrow it down."
                  : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </Text>
          ) : null
        }
      />

      <StandaloneTabBar />
    </View>
  );
}

function ResultRow({
  token,
  onPress,
}: {
  token: TokenSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Open ${token.name}`}
    >
      {/* `imageUrl` is never empty — a token with no artwork gets the same
          deterministic placeholder the detail screen and the website draw, so
          one token shows one image everywhere. */}
      <Image
        source={{ uri: token.imageUrl }}
        style={[styles.thumb, token.imageIsPlaceholder && styles.thumbFaded]}
        resizeMode="cover"
      />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {token.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {token.protocolLabel}
          {token.subtitle ? ` · ${token.subtitle}` : ""}
        </Text>
      </View>
      <View style={styles.rowPrice}>
        {token.listed && token.floorPriceSats != null ? (
          <>
            <Text style={styles.priceValue}>
              {formatSatsAsBtc(token.floorPriceSats)}
            </Text>
            <Text style={styles.priceLabel}>
              floor · {token.offersCount} offer
              {token.offersCount === 1 ? "" : "s"}
            </Text>
          </>
        ) : (
          <Text style={styles.priceLabel}>Not listed</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  clear: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  clearText: { color: colors.muted, fontSize: 16 },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHover,
  },
  thumbFaded: { opacity: 0.45 },
  rowText: { flex: 1, gap: 2 },
  rowName: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  rowMeta: { fontSize: 12, color: colors.muted, fontFamily: fonts.sans },
  rowPrice: { alignItems: "flex-end", gap: 2 },
  priceValue: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  priceLabel: { fontSize: 11, color: colors.muted, fontFamily: fonts.sans },

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
    paddingVertical: spacing.sm,
  },
  footer: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
