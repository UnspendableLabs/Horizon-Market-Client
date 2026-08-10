import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  SwapList,
  useHorizonMarket,
  useToken,
  useTokenActivity,
  useTokenChart,
  type TokenDetail,
  type TokenProperty,
  type TokenPropertyGroup,
  type TokenRef,
  type TokenSection,
  type SwapListingType,
} from "@unspendablelabs/horizon-market-client/react";
// Type-only, so it is erased at compile time and never pulls the root entry
// (and its Kontor WASM) into the bundle — same as lib/analytics/events.ts.
import type { KontorAssetKind } from "@unspendablelabs/horizon-market-client";
import { Header } from "../../../components/Header.js";
import { StandaloneTabBar } from "../../../components/TabBar.js";
import { TokenChart } from "../../../components/TokenChart.js";
import {
  TokenImage,
  tokenHasBrandMark,
} from "../../../components/TokenImage.js";
import { TokenValueRow } from "../../../components/TokenValueView.js";
import { getPrivateKey } from "../../../lib/web3auth.js";
import { colors, fonts, radii, spacing } from "../../../lib/theme.js";
import {
  tokenOriginFromRoute,
  tokenRefFromRoute,
} from "../../../lib/token-links.js";
import {
  formatCount,
  formatDecimalString,
  formatSatsAsBtc,
  formatTimeAgo,
  mempoolTxUrl,
  stripHtml,
  truncateMiddle,
} from "../../../lib/token-format.js";
import { trackTokenViewed } from "../../../lib/analytics/events.js";

/**
 * Token detail — the same screen for a Counterparty asset, ZELD, an ordinal
 * inscription, the Kontor KOR token and a Kontor NFT.
 *
 * That is possible because `/api/tokens/*` normalises all five onto one shape:
 * `stats` and `properties` are ordered lists of typed values, and
 * `availableSections` says which sub-resources exist. So this screen branches on
 * the *payload*, never on the protocol — a new asset type (or a new stat row)
 * shows up here with no change.
 *
 * A root-stack route pushed over the tab pager, wearing the same chrome as
 * /profile (Header above, StandaloneTabBar below) so it reads as an ordinary
 * screen: tapping any tab takes the user straight there.
 */

/**
 * Section tabs, in the order the API lists them, plus the two that are always
 * on: Info (everything the payload describes about the token itself) and Offers.
 */
type Tab = "info" | "offers" | TokenSection;

const SECTION_LABELS: Record<TokenSection, string> = {
  chart: "Chart",
  activity: "Activity",
  holders: "Holders",
  attributes: "Attributes",
  transactions: "Transactions",
};

const GROUP_LABELS: Record<TokenPropertyGroup, string> = {
  overview: "Overview",
  issuance: "Issuance",
  links: "Links",
  technical: "Technical",
};

/** Sections this screen can actually draw. `holders` is not in the API yet. */
const RENDERABLE: TokenSection[] = ["chart", "activity"];

/**
 * Why a token isn't here. Worth being specific: on mainnet a Kontor id is not
 * "unknown", it is *elsewhere* — Kontor lives on signet only, and telling a user
 * that is the difference between a dead end and a network switch.
 */
function notAvailableReason(
  ref: TokenRef | null,
  network: "mainnet" | "testnet",
): string {
  if (!ref) return "That link doesn't name a token this app knows.";
  const isKontor = ref.protocol === "kontor" || ref.protocol === "kontor-nft";
  if (isKontor && network === "mainnet") {
    return "Kontor tokens live on signet. Switch network in Settings to see this one.";
  }
  return network === "mainnet"
    ? "Nothing under this name on mainnet."
    : "Nothing under this name on this network.";
}

export default function TokenScreen() {
  const params = useLocalSearchParams<{
    protocol?: string;
    id?: string;
    from?: string;
  }>();
  const ref = useMemo(() => tokenRefFromRoute(params), [params]);
  const from = tokenOriginFromRoute(params.from);
  const { network } = useHorizonMarket();
  const { token, loading, notFound, error, refresh } = useToken(ref);

  // Fires once the payload lands rather than on mount, so the event carries the
  // protocol — the bare pageview already covers "someone opened a token screen".
  // Keyed on the token's identity, not the payload object: a `refresh` hands
  // back a new object for the same token, and re-emitting there would count one
  // view twice.
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || reportedRef.current === token.canonicalId) return;
    reportedRef.current = token.canonicalId;
    trackTokenViewed({ protocol: token.protocol, from });
  }, [token, from]);

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading && !token ? (
          <View style={styles.notice}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : notFound || !ref ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Token not available</Text>
            <Text style={styles.noticeText}>{notAvailableReason(ref, network)}</Text>
          </View>
        ) : error && !token ? (
          <View style={styles.notice}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={refresh}
              style={styles.secondaryButton}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : token ? (
          <TokenBody token={token} />
        ) : null}
      </ScrollView>
      <StandaloneTabBar />
    </View>
  );
}

function TokenBody({ token }: { token: TokenDetail }) {
  const ref = { protocol: token.protocol, id: token.id };
  // Sections come from the payload — the tab bar is built from what the server
  // says exists, minus the ones with no renderer here yet.
  const sections = token.availableSections.filter((s) => RENDERABLE.includes(s));
  const [tab, setTab] = useState<Tab>("info");

  return (
    <View style={styles.sections}>
      {/* Above the tabs: the artwork and the name, and nothing else. Everything
          the payload says *about* the token lives in the Info tab, so the four
          tabs sit near the top of the screen instead of below a page-length
          preamble the reader has to scroll past to reach the offers. */}
      <Hero token={token} />

      {/* Section tabs: Info and Offers are always available — every payload
          carries stats or properties, and every token type can be listed. The
          rest come straight from `availableSections`. */}
      <View style={styles.tabs}>
        <TabButton
          label="Info"
          active={tab === "info"}
          onPress={() => setTab("info")}
        />
        <TabButton
          label={`Offers${token.offers.count > 0 ? ` (${token.offers.count})` : ""}`}
          active={tab === "offers"}
          onPress={() => setTab("offers")}
        />
        {sections.map((section) => (
          <TabButton
            key={section}
            label={SECTION_LABELS[section]}
            active={tab === section}
            onPress={() => setTab(section)}
          />
        ))}
      </View>

      {tab === "info" && <InfoSection token={token} />}
      {tab === "offers" && <OffersSection token={token} />}
      {tab === "chart" && <ChartSection token={token} />}
      {tab === "activity" && <ActivitySection tokenRef={ref} />}
    </View>
  );
}

/**
 * Everything the payload describes about the token itself: its description, the
 * market tiles, the typed stat and property rows, attributes, links. The name,
 * subtitle and tagline stay in the hero — they identify the token rather than
 * describe it, and a tab you have to open to learn what you are looking at is
 * no header at all.
 */
function InfoSection({ token }: { token: TokenDetail }) {
  const { media } = token;
  // Whatever `kind` says, `imageUrl` is always an actual image — an HTML or
  // audio inscription gets a placeholder in the hero and its real payload in
  // `contentUrl`, which is what the button below opens.
  const richContent =
    media.kind !== "image" && media.kind !== "none" ? media.contentUrl : null;
  // A Counterparty description is free-form and often raw HTML; a <Text> would
  // print the markup.
  const description = stripHtml(token.description);
  const hasProse = Boolean(description) || Boolean(richContent);

  return (
    <View style={styles.sections}>
      {hasProse && (
        <View style={styles.prose}>
          {description && <Text style={styles.description}>{description}</Text>}
          {richContent && (
            <Pressable
              onPress={() => void Linking.openURL(richContent)}
              style={styles.secondaryButton}
              accessibilityRole="link"
            >
              <Text style={styles.secondaryButtonText}>
                Open {media.kind} content ↗
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {token.market && <MarketBlock token={token} />}

      {token.stats.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Stats</Text>
          <View style={styles.card}>
            {token.stats.map((stat, index) => (
              <View key={stat.key}>
                {index > 0 && <View style={styles.divider} />}
                <TokenValueRow label={stat.label} value={stat.value} />
              </View>
            ))}
          </View>
        </View>
      )}

      <PropertyBlocks properties={token.properties} />

      {token.attributes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Attributes</Text>
          <View style={styles.attributes}>
            {token.attributes.map((attribute) => (
              <View
                key={`${attribute.name}:${attribute.value}`}
                style={styles.attribute}
              >
                <Text style={styles.attributeName}>{attribute.name}</Text>
                <Text style={styles.attributeValue}>{attribute.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* `links` and the `links` property group carry the same URLs for every
          token type that has both, so these buttons are a fallback for a payload
          that ships links without the group rather than a second copy of it. */}
      {token.links.length > 0 &&
        !token.properties.some((p) => p.group === "links") && (
          <View style={styles.linkRow}>
            {token.links.map((link) => (
              <Pressable
                key={`${link.kind}:${link.url}`}
                onPress={() => void Linking.openURL(link.url)}
                style={styles.secondaryButton}
                accessibilityRole="link"
              >
                <Text style={styles.secondaryButtonText}>{link.label} ↗</Text>
              </Pressable>
            ))}
          </View>
        )}
    </View>
  );
}

/** Artwork and identity — the only thing standing above the tab bar. */
function Hero({ token }: { token: TokenDetail }) {
  const { media } = token;
  const ref = { protocol: token.protocol, id: token.id };
  // XCP is reported as placeholder-imaged but <TokenImage> draws its brand mark,
  // so it keeps the inset every other real logo gets.
  const bareGradient = media.imageIsPlaceholder && !tokenHasBrandMark(ref);

  return (
    <View style={styles.hero}>
      {/* The generated placeholder is a background, not artwork: it fills the
          panel edge to edge (no inset) so it doesn't read as a small pastel
          square floating in a dark box. */}
      <View style={[styles.mediaPanel, bareGradient && styles.mediaPanelBare]}>
        <TokenImage
          uri={media.imageLargeUrl || media.imageUrl}
          isPlaceholder={media.imageIsPlaceholder}
          name={token.name}
          token={ref}
          style={styles.media}
          resizeMode="contain"
          monogramSize={56}
        />
      </View>

      {/* Subtitle and tagline stay with the name: they are identity (the
          collection it belongs to, its one-line billing), not description —
          which is why the long prose goes to Info and these two do not. */}
      <View style={styles.heroText}>
        <View style={styles.heroTitleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {token.name}
          </Text>
          <View style={styles.protocolChip}>
            <Text style={styles.protocolChipText}>{token.protocolLabel}</Text>
          </View>
        </View>
        {token.subtitle && <Text style={styles.subtitle}>{token.subtitle}</Text>}
        {token.tagline && <Text style={styles.tagline}>{token.tagline}</Text>}
      </View>
    </View>
  );
}

function MarketBlock({ token }: { token: TokenDetail }) {
  const market = token.market;
  if (!market) return null;

  // Every price is integer sats, per whole unit — so floor and last are directly
  // comparable, and both are formatted the same way.
  const tiles: { label: string; value: string }[] = [
    {
      label: "Floor",
      value:
        market.floorPriceSats != null
          ? formatSatsAsBtc(market.floorPriceSats)
          : "Not listed",
    },
    {
      label: "Last price",
      value:
        market.lastPriceSats != null
          ? formatSatsAsBtc(market.lastPriceSats)
          : "—",
    },
    {
      label: "Market cap",
      value:
        market.marketCapSats != null
          ? formatSatsAsBtc(market.marketCapSats)
          : "—",
    },
    {
      label: "Volume",
      value: market.volumeSats != null ? formatSatsAsBtc(market.volumeSats) : "—",
    },
    { label: "Holders", value: formatCount(market.holders) },
    { label: "Supply", value: formatDecimalString(market.supply) },
    { label: "Trades", value: formatCount(market.tradeCount) },
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Market</Text>
      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <View key={tile.label} style={styles.tile}>
            <Text style={styles.tileLabel}>{tile.label}</Text>
            <Text style={styles.tileValue} numberOfLines={1}>
              {tile.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PropertyBlocks({ properties }: { properties: TokenProperty[] }) {
  // The array is already in display order; group it without reordering, so a
  // group's rows stay exactly as the server sequenced them.
  const groups: { group: TokenPropertyGroup; rows: TokenProperty[] }[] = [];
  for (const property of properties) {
    const last = groups[groups.length - 1];
    if (last && last.group === property.group) last.rows.push(property);
    else groups.push({ group: property.group, rows: [property] });
  }

  return (
    <>
      {groups.map(({ group, rows }) => (
        <View key={`${group}:${rows[0]?.key}`} style={styles.section}>
          <Text style={styles.sectionLabel}>{GROUP_LABELS[group]}</Text>
          <View style={styles.card}>
            {rows.map((row, index) => (
              <View key={row.key}>
                {index > 0 && <View style={styles.divider} />}
                <TokenValueRow label={row.label} value={row.value} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

function OffersSection({ token }: { token: TokenDetail }) {
  // Pin the feed with the server's OWN description of what is buyable
  // (`offers.atomicSwapsQuery`) rather than guessing a filter here: those keys
  // are exactly the ones `GET /api/atomic-swaps` parses, so the list matches the
  // `count` above it. Facets do not honour the pin, hence `includeFacets` off.
  //
  // Every key it can send is forwarded — dropping one (`expired`,
  // `exclude_pending`, `unattached`) is exactly how a list drifts away from the
  // count rendered above it. `funded` / `delisted` / `filled` are the open-offer
  // defaults `useSwapList` already sends.
  const query = token.offers.atomicSwapsQuery;
  const assetName = query.asset_name;
  const kontorNftId = query.kontor_nft_id;
  // A fixed pin, not `defaultListingType`: the type is a property of the asset
  // this feed is pinned to, so a filter control could only answer an empty list
  // under a non-zero count. `SwapList` hides the control while it is pinned.
  const listingType = query.listing_type;
  // KOR and Kontor NFTs share one listing type, so without this the KOR page's
  // offers would also list every NFT — against a count that excluded them.
  const kontorAssetKind = query.kontor_asset_kind;
  // Absent means "don't send it" (the server's default applies), which is not
  // the same as sending `false` — hence the tri-state rather than a truthiness
  // check on the string.
  const flag = (value: string | undefined): boolean | undefined =>
    value === undefined ? undefined : value === "true";

  return (
    <View style={styles.offers}>
      <SwapList
        getPrivateKey={getPrivateKey}
        // No toolbar here. The feed is already narrowed to this token, so the
        // Buy screen's browsing controls (type, sort, My swaps, Sold) would sit
        // above a handful of rows that are all the same asset — the reader came
        // for *this* token's offers, not to re-filter the market inside a tab.
        showToolbar={false}
        {...(assetName ? { assetName } : {})}
        {...(kontorNftId ? { kontorNftId } : {})}
        {...(kontorAssetKind
          ? { kontorAssetKind: kontorAssetKind as KontorAssetKind }
          : {})}
        {...(listingType ? { listingType: listingType as SwapListingType } : {})}
        expired={flag(query.expired)}
        excludePending={flag(query.exclude_pending)}
        unattached={flag(query.unattached)}
        includePendingOrders={false}
        style={styles.offersList}
      />
      {token.offers.count === 0 && (
        <Text style={styles.noticeText}>
          Nothing listed right now. Anyone holding this can list it from the Sell
          tab.
        </Text>
      )}
    </View>
  );
}

function ChartSection({ token }: { token: TokenDetail }) {
  const { chart, loading, error, range, setRange } = useTokenChart(
    { protocol: token.protocol, id: token.id },
    token.chart ? { defaultRange: token.chart.defaultRange } : undefined,
  );

  return (
    <TokenChart
      chart={chart}
      loading={loading}
      error={error}
      range={range}
      ranges={token.chart?.ranges ?? ["1W", "1M", "1Y", "max"]}
      onRangeChange={setRange}
    />
  );
}

function ActivitySection({
  tokenRef,
}: {
  tokenRef: { protocol: TokenDetail["protocol"]; id: string };
}) {
  const { network, kontorNetwork } = useHorizonMarket();
  const { items, total, loading, loadingMore, error, hasMore, loadMore } =
    useTokenActivity(tokenRef);

  if (loading) {
    return (
      <View style={styles.notice}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error) return <Text style={styles.errorText}>{error}</Text>;
  if (items.length === 0) {
    return <Text style={styles.noticeText}>No sales yet.</Text>;
  }

  return (
    <View style={styles.section}>
      <View style={styles.card}>
        {items.map((item, index) => {
          const url = mempoolTxUrl(network, kontorNetwork, item.txid);
          const row = (
            <View style={styles.activityRow}>
              <View style={styles.activityLeft}>
                <Text style={styles.activityPrice}>
                  {item.priceSats != null ? formatSatsAsBtc(item.priceSats) : "—"}
                </Text>
                <Text style={styles.activityMeta}>
                  {item.quantity ? `${formatDecimalString(item.quantity)} · ` : ""}
                  {formatTimeAgo(item.time)}
                </Text>
              </View>
              <View style={styles.activityRight}>
                {item.buyerAddress && (
                  <Text style={styles.activityMeta} numberOfLines={1}>
                    to {truncateMiddle(item.buyerAddress, 6, 4)}
                  </Text>
                )}
                {url && <Text style={styles.activityLink}>tx ↗</Text>}
              </View>
            </View>
          );

          return (
            <View key={`${item.txid ?? "sale"}:${item.time}:${index}`}>
              {index > 0 && <View style={styles.divider} />}
              {url ? (
                <Pressable
                  onPress={() => void Linking.openURL(url)}
                  accessibilityRole="link"
                >
                  {row}
                </Pressable>
              ) : (
                row
              )}
            </View>
          );
        })}
      </View>

      {hasMore && (
        <Pressable
          onPress={loadMore}
          disabled={loadingMore}
          style={[styles.secondaryButton, loadingMore && styles.buttonDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>
            {loadingMore ? "Loading…" : `Show more (${items.length}/${total})`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function TabButton({
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
      style={[styles.tab, active && styles.tabActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },

  sections: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  hero: { gap: spacing.md },
  mediaPanel: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "rgba(0, 0, 0, 0.33)",
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  mediaPanelBare: { padding: 0 },
  media: { width: "100%", height: "100%", borderRadius: radii.md },
  heroText: { gap: spacing.xs },
  // The description block that used to sit under the name; same rhythm, now the
  // opening block of the Info tab.
  prose: { gap: spacing.xs },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  protocolChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceHover,
  },
  protocolChipText: {
    fontSize: 11,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },
  subtitle: { fontSize: 14, color: colors.mutedStrong, fontFamily: fonts.sans },
  tagline: { fontSize: 13, color: colors.muted, fontFamily: fonts.sans },
  description: {
    fontSize: 13,
    color: colors.mutedStrong,
    fontFamily: fonts.sans,
    lineHeight: 19,
  },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "30%",
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tileLabel: { fontSize: 11, color: colors.muted, fontFamily: fonts.sans },
  tileValue: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.border },

  attributes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  attribute: {
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  attributeName: { fontSize: 10, color: colors.muted, fontFamily: fonts.sans },
  attributeValue: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },

  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    paddingBottom: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.sm,
  },
  tabActive: { backgroundColor: colors.surfaceHover },
  tabText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  tabTextActive: { color: colors.foreground },

  offers: { gap: spacing.sm },
  // <SwapList> normally fills a screen; inside this scroll view it must size to
  // its content instead, so no flex:1 here.
  offersList: { backgroundColor: "transparent" },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  activityLeft: { flexShrink: 1, gap: 2 },
  activityRight: { alignItems: "flex-end", gap: 2 },
  activityPrice: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  activityMeta: { fontSize: 11, color: colors.muted, fontFamily: fonts.sans },
  activityLink: {
    fontSize: 11,
    color: colors.primary,
    fontFamily: fonts.sansSemiBold,
  },

  secondaryButton: {
    alignSelf: "flex-start",
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
  buttonDisabled: { opacity: 0.5 },

  notice: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  noticeTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  noticeText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
    lineHeight: 19,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
});
