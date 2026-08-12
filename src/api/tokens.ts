import { HttpClient, HorizonMarketApiError } from "./http.js";
import type { AtomicSwap, RequestOptions } from "../types/index.js";

/**
 * Tokens — `/api/tokens/*`.
 *
 * Horizon trades five unrelated things: Counterparty assets, ZELD, Ordinals
 * inscriptions, the Kontor KOR token and Kontor NFTs. Each is assembled from a
 * different backend, but this API normalises all five onto ONE payload shape, so
 * a client renders any token with one component tree instead of five.
 *
 * ```
 * GET /api/tokens/counterparty/{asset}   [/chart] [/activity]
 * GET /api/tokens/ZELD                   [/chart] [/activity]
 * GET /api/tokens/ordinals/{inscription} [/chart] [/activity]
 * GET /api/tokens/kontor/KOR             [/chart] [/activity]   ← signet only
 * GET /api/tokens/kontor/nfts/{nft_id}   [/activity]            ← signet only
 * GET /api/tokens/search?q=…
 * GET /api/tokens?protocol=…             ← one page of one catalogue
 * ```
 *
 * Everything here is public, unauthenticated and GET-only.
 *
 * Two conventions the server holds to, and this module preserves:
 *
 * - **Values are typed, never pre-formatted.** {@link TokenStat} and
 *   {@link TokenProperty} carry a {@link TokenValue} whose `type` says how to
 *   render it — the server has no idea what locale or width it is rendering
 *   into. A new row appears without any client change.
 * - **Every price is an integer count of satoshis** (the `Sats` suffix), while
 *   supplies and traded quantities stay **decimal strings**: they are bigint at
 *   rest and exceed what a float represents exactly.
 */

// ─── Wire types (snake_case, internal only) ──────────────────────────────────

interface WireTokenValue {
  type: TokenValueType;
  value: string | number | boolean | Record<string, unknown> | null;
  unit: string | null;
  sub_label: string | null;
  url: string | null;
  tone: TokenValueTone | null;
}

interface WireTokenStat {
  key: string;
  label: string;
  value: WireTokenValue;
}

interface WireTokenProperty extends WireTokenStat {
  group: TokenPropertyGroup;
}

interface WireTokenMedia {
  kind: TokenMediaKind;
  image_url: string;
  image_large_url: string;
  image_is_placeholder: boolean;
  thumbnail_url: string | null;
  content_url: string | null;
  content_type: string | null;
  audio_url: string | null;
  video_url: string | null;
  embed_url: string | null;
  embed_height: number | null;
}

interface WireTokenMarket {
  quote_asset: string;
  last_price_sats: number | null;
  floor_price_sats: number | null;
  market_cap_sats: number | null;
  volume_sats: number | null;
  price_change_percent: number | null;
  holders: number | null;
  supply: string | null;
  supply_locked: boolean | null;
  divisible: boolean | null;
  trade_count: number | null;
}

interface WireTokenOffers {
  count: number;
  floor_price_sats: number | null;
  web_url: string;
  atomic_swaps_query: Record<string, string>;
}

interface WireTokenDetail {
  protocol: TokenProtocol;
  protocol_label: string;
  id: string;
  canonical_id: string;
  network: TokenNetwork;
  name: string;
  subtitle: string | null;
  tagline: string | null;
  description: string | null;
  media: WireTokenMedia;
  stats: WireTokenStat[];
  properties: WireTokenProperty[];
  attributes: { name: string; value: string }[];
  market: WireTokenMarket | null;
  offers: WireTokenOffers;
  links: TokenLink[];
  collection: { name: string; slug: string; web_url: string } | null;
  issuer: {
    address: string;
    username: string | null;
    profile_url: string | null;
    royalty_percent: number | null;
  } | null;
  capabilities?: Record<TokenSection, boolean>;
  available_sections: TokenSection[];
  chart: {
    default_range: TokenChartRange;
    ranges: TokenChartRange[];
    url: string;
  } | null;
  web_url: string;
  generated_at: string;
}

interface WireTokenChartPoint {
  time: string;
  price: number;
  volume: number;
  type: string;
}

interface WireTokenChart {
  range: TokenChartRange | null;
  from: string;
  to: string;
  interval_seconds: number;
  interval_label: string;
  quote_asset: string;
  price_unit: "sats";
  volume_unit: string;
  trade_count: number;
  points: WireTokenChartPoint[];
}

interface WireTokenActivityItem {
  time: string;
  event_type: "sale";
  price_sats: number | null;
  quantity: string | null;
  buyer_address: string | null;
  seller_address: string | null;
  txid: string | null;
}

interface WireTokenActivityPage {
  activity: WireTokenActivityItem[];
  pagination: { total: number; offset: number; limit: number | null };
}

interface WireTokenSummary {
  protocol: TokenProtocol;
  protocol_label: string;
  id: string;
  canonical_id: string;
  network: TokenNetwork;
  name: string;
  subtitle: string | null;
  image_url: string;
  image_is_placeholder: boolean;
  thumbnail_url: string | null;
  floor_price_sats: number | null;
  offers_count: number;
  listed: boolean;
  collection: { name: string; slug: string } | null;
  api_url: string;
  web_url: string;
}

interface WireTokenSearchSummary extends WireTokenSummary {
  match: TokenMatch;
}

interface WireTokenSearchResult {
  query: string;
  results: WireTokenSearchSummary[];
  truncated: boolean;
  sources: Record<string, TokenSearchSourceStatus>;
  offers: TokenOfferAggregateStatus;
}

interface WireTokenListResult {
  protocol: BrowsableTokenProtocol;
  listed_only: boolean;
  source: TokenListSource;
  results: WireTokenSummary[];
  pagination: { total: number; offset: number; limit: number };
  hydration: TokenHydrationStatus;
  artwork: TokenArtworkStatus;
  offers: TokenOfferAggregateStatus;
}

// ─── Domain types ────────────────────────────────────────────────────────────

export type TokenProtocol =
  | "counterparty"
  | "zeld"
  | "ordinals"
  | "kontor"
  | "kontor-nft";

/**
 * The network a token payload was served for.
 *
 * NOT the SDK's `Network`: the API distinguishes signet from testnet4 (Kontor
 * lives on signet only), where the SDK collapses both onto `"testnet"` because
 * they share Bitcoin address parameters.
 */
export type TokenNetwork = "mainnet" | "signet" | "testnet4";

/**
 * How to interpret and render {@link TokenValue.value}. `sats` is split from
 * `number` because it is always an integer count of satoshis a client will want
 * to show as BTC or in fiat; a plain `number` is whatever `unit` says it is.
 */
export type TokenValueType =
  | "text"
  | "number"
  | "sats"
  | "link"
  | "address"
  | "txid"
  | "datetime"
  | "boolean"
  | "badge"
  | "json";

export type TokenValueTone = "neutral" | "positive" | "warning" | "danger";

export interface TokenValue {
  type: TokenValueType;
  /** Shape follows {@link type}: `datetime` is RFC 3339, `sats` an integer, etc. */
  value: string | number | boolean | Record<string, unknown> | null;
  /** Unit for `number`/`sats` rows — "BTC", "XCP", "KOR", "%". */
  unit: string | null;
  /** Second line under the value: "Divisible", "Locked", "@alice". */
  subLabel: string | null;
  /** Tap target for `link`/`address`/`txid` rows. */
  url: string | null;
  /** Only meaningful for `badge`. */
  tone: TokenValueTone | null;
}

export interface TokenStat {
  key: string;
  label: string;
  value: TokenValue;
}

/**
 * Which block of a detail screen a property belongs to. Clients may render the
 * groups as sections or ignore them and show one flat list — the array is in
 * display order either way.
 */
export type TokenPropertyGroup = "overview" | "issuance" | "links" | "technical";

export interface TokenProperty extends TokenStat {
  group: TokenPropertyGroup;
}

export type TokenMediaKind =
  | "image"
  | "video"
  | "audio"
  | "embed"
  | "html"
  | "text"
  | "none";

export interface TokenMedia {
  kind: TokenMediaKind;
  /**
   * Absolute URL of something a client can put in an `<Image>`. **Never empty**:
   * a token with no artwork of its own gets a deterministic placeholder (see
   * {@link imageIsPlaceholder}), so "sometimes there is no image" is not a branch
   * every client has to carry.
   *
   * Always an actual image, whatever {@link kind} says — an HTML or audio
   * inscription has no renderable still, so its real payload travels in
   * {@link contentUrl} instead.
   */
  imageUrl: string;
  /** Larger variant, or {@link imageUrl} itself when there is only one size. */
  imageLargeUrl: string;
  /** True when {@link imageUrl} is the generated placeholder, not the token's art. */
  imageIsPlaceholder: boolean;
  thumbnailUrl: string | null;
  /**
   * Raw content, always served from the Horizon origin — upstream hosts (the ord
   * server, Kontor Portal signed URLs) are either unreachable cross-origin or
   * expire.
   */
  contentUrl: string | null;
  contentType: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  embedUrl: string | null;
  embedHeight: number | null;
}

/**
 * Fungible-market figures. `null` as a whole for a token with no market at all
 * (a Kontor NFT), and `null` per field where the protocol has no such concept.
 */
export interface TokenMarket {
  quoteAsset: string;
  lastPriceSats: number | null;
  /**
   * Cheapest open offer, **per whole unit**, so it is directly comparable with
   * {@link lastPriceSats}. For a one-of-a-kind token (an inscription, a Kontor
   * NFT) a unit is the whole thing, so this is the listing's total price.
   */
  floorPriceSats: number | null;
  marketCapSats: number | null;
  volumeSats: number | null;
  priceChangePercent: number | null;
  holders: number | null;
  /** Decimal string — supplies exceed what a float represents exactly. */
  supply: string | null;
  supplyLocked: boolean | null;
  divisible: boolean | null;
  /** All-time completed trades for this token, never a windowed subset. */
  tradeCount: number | null;
}

/**
 * Open offers for this token.
 *
 * Deliberately not a sub-resource: {@link atomicSwapsQuery} is the literal query
 * to hand to `GET /api/atomic-swaps` (i.e. `client.listSwaps` /
 * `useSwapList`), so there is no second source of truth for what is buyable.
 * Every key in it is one that endpoint actually parses.
 */
export interface TokenOffers {
  count: number;
  /** Same figure and unit as {@link TokenMarket.floorPriceSats}. */
  floorPriceSats: number | null;
  webUrl: string;
  atomicSwapsQuery: Record<string, string>;
}

export interface TokenLink {
  kind: string;
  label: string;
  url: string;
}

export type TokenSection =
  | "chart"
  | "activity"
  | "holders"
  | "attributes"
  | "transactions";

export type TokenChartRange = "1W" | "1M" | "1Y" | "max";

export interface TokenDetail {
  protocol: TokenProtocol;
  protocolLabel: string;
  /** Canonical id — exactly what the path segment resolved to. */
  id: string;
  /** `"counterparty:RAREPEPE"` — a stable client-side cache key. */
  canonicalId: string;
  network: TokenNetwork;

  name: string;
  subtitle: string | null;
  tagline: string | null;
  description: string | null;

  media: TokenMedia;
  stats: TokenStat[];
  properties: TokenProperty[];
  attributes: { name: string; value: string }[];
  market: TokenMarket | null;
  offers: TokenOffers;
  links: TokenLink[];

  collection: { name: string; slug: string; webUrl: string } | null;
  issuer: {
    address: string;
    username: string | null;
    profileUrl: string | null;
    royaltyPercent: number | null;
  } | null;

  /**
   * Which sub-resources exist for this token. {@link availableSections} is the
   * subset that is true, in display order — it drives a tab bar directly, so no
   * client-side knowledge of protocols is needed.
   */
  capabilities: Record<TokenSection, boolean>;
  availableSections: TokenSection[];

  chart: {
    defaultRange: TokenChartRange;
    ranges: TokenChartRange[];
    url: string;
  } | null;

  webUrl: string;
  generatedAt: string;
}

export interface TokenChartPoint {
  time: string;
  price: number;
  volume: number;
  type: string;
}

export interface TokenChart {
  range: TokenChartRange | null;
  from: string;
  to: string;
  intervalSeconds: number;
  intervalLabel: string;
  quoteAsset: string;
  priceUnit: "sats";
  /** What `volume` counts — an asset name, or "sales" for one-of-a-kind tokens. */
  volumeUnit: string;
  tradeCount: number;
  points: TokenChartPoint[];
}

export interface TokenActivityItem {
  time: string;
  eventType: "sale";
  /** The trade's **total** price, not a per-unit one. */
  priceSats: number | null;
  /**
   * How much of the token changed hands, in whole units, as a decimal string —
   * `null` when the row's divisibility (and so its scale) is unknown.
   */
  quantity: string | null;
  buyerAddress: string | null;
  sellerAddress: string | null;
  txid: string | null;
}

export interface TokenActivityPage {
  items: TokenActivityItem[];
  total: number;
  offset: number;
  limit: number | null;
}

/** Which part of the token a search query matched, and how tightly. */
export type TokenMatchKind = "exact" | "prefix" | "contains";

export type TokenMatchField =
  | "name"
  | "longname"
  | "id"
  | "inscription_number"
  | "symbol";

export interface TokenMatch {
  field: TokenMatchField;
  kind: TokenMatchKind;
}

/**
 * One row of a list — a search hit or a browse page — and a strict subset of
 * {@link TokenDetail}'s fields, using the same names, so a result row and a
 * detail header render from one shape.
 *
 * Search adds one field of its own ({@link TokenSearchSummary.match}); nothing
 * else differs, so a single row component draws both.
 */
export interface TokenSummary {
  protocol: TokenProtocol;
  protocolLabel: string;
  /** Canonical id — what {@link tokenApiPath} expects as its path segment. */
  id: string;
  canonicalId: string;
  network: TokenNetwork;

  name: string;
  subtitle: string | null;

  /** Never empty — same placeholder guarantee as {@link TokenMedia.imageUrl}. */
  imageUrl: string;
  imageIsPlaceholder: boolean;
  thumbnailUrl: string | null;

  /** Cheapest open offer per whole unit, or `null` when nothing is listed. */
  floorPriceSats: number | null;
  offersCount: number;
  listed: boolean;

  collection: { name: string; slug: string } | null;

  /** Absolute URL of this token's own detail endpoint. */
  apiUrl: string;
  webUrl: string;
}

/** A {@link TokenSummary} plus which part of it a search query matched. */
export interface TokenSearchSummary extends TokenSummary {
  match: TokenMatch;
}

/**
 * Per-source outcome. A search that silently drops a slow protocol looks exactly
 * like one where that protocol had no matches, so the server reports each one:
 * `skipped` is deterministic (a protocol filter, or Kontor off signet), while
 * `timeout`/`error` mean the answer is incomplete.
 */
export type TokenSearchSourceStatus = "ok" | "timeout" | "error" | "skipped";

/**
 * Outcome of the cross-protocol offer aggregate, which is not one of the sources:
 * it runs once, over whatever they found. When it fails every row comes back
 * `listed: false` with no floor price.
 */
export type TokenOfferAggregateStatus = "ok" | "error";

export interface TokenSearchResult {
  query: string;
  results: TokenSearchSummary[];
  /** True when at least one source had more matches than `limit` allowed. */
  truncated: boolean;
  sources: Record<string, TokenSearchSourceStatus>;
  offers: TokenOfferAggregateStatus;
}

/**
 * The token types with a catalogue worth paging.
 *
 * ZELD and KOR are absent because each is a *single* token: a list of them is a
 * list of one, and their detail endpoints (`/api/tokens/ZELD`,
 * `/api/tokens/kontor/KOR`) are the way to read them. Asking {@link listTokens}
 * for either is a 400 naming the route that works.
 */
export const BROWSABLE_TOKEN_PROTOCOLS = [
  "counterparty",
  "ordinals",
  "kontor-nft",
] as const;

export type BrowsableTokenProtocol = (typeof BROWSABLE_TOKEN_PROTOCOLS)[number];

/**
 * Where a browse page came from, and therefore what its `total` counts.
 *
 * The upstreams are not equally deep, and a client paging a grid has to know
 * whether it is walking a catalogue or a window — otherwise "the list ended at
 * row 100" reads as a bug rather than as the edge of what is browsable.
 *
 * - `catalogue` — the protocol's full catalogue; `total` is exact and paging
 *   runs to the end of it.
 * - `recent_window` — a cron-warmed window of the newest items, because the
 *   upstream offers no cheap deep pagination. `total` is the window's size, not
 *   the number of tokens in existence; {@link searchTokens} reaches the rest.
 *   Ordinals only.
 * - `order_book` — Horizon's open offers; `total` is exact. Only under
 *   `listedOnly`.
 */
export type TokenListSource = "catalogue" | "recent_window" | "order_book";

/**
 * Whether a page's rows carry the names and collections their protocol knows
 * them by.
 *
 * Only an `order_book` page can degrade: it selects tokens by identifier, so
 * naming them means a second lookup per protocol. When that fails the rows are
 * still real, openable and priced — but named `A9587…` rather than
 * `RAREPEPE.card`, which reads like a catalogue of unnamed assets rather than
 * like an outage. Hence the flag.
 *
 * Artwork has {@link TokenArtworkStatus} of its own: a page short of pictures
 * and a page short of names are not the same event, and a UI that warns about
 * the second should not warn about the first.
 */
export type TokenHydrationStatus = "ok" | "error";

/**
 * Whether every row that *could* be illustrated was.
 *
 * Most of the Counterparty catalogue keeps its image in the asset description
 * rather than in a column, so illustrating a page means the server resolving
 * those descriptions against third-party hosts, under a deadline. Rows that lose
 * that race keep `imageIsPlaceholder: true`.
 *
 * `partial`, not `error`: nothing failed. The page is simply less illustrated
 * than the next one will be — the resolutions that missed the deadline finish
 * into the server's own cache — so this is a reason to re-read, never a reason
 * to put an error in front of a user. An asset with no artwork anywhere leaves
 * this `ok`: a pass that finished having found nothing is finished.
 */
export type TokenArtworkStatus = "ok" | "partial";

export interface TokenListParams {
  /** Which catalogue to page. Required — there is no default protocol. */
  protocol: BrowsableTokenProtocol;
  offset?: number;
  /** Page size, capped at 100 by the server. Defaults to 20. */
  limit?: number;
  /**
   * Only tokens with at least one open offer. Pages Horizon's order book rather
   * than the protocol's catalogue, so `source` comes back `order_book`.
   */
  listedOnly?: boolean;
}

/** One page of one protocol's tokens. */
export interface TokenListPage {
  protocol: BrowsableTokenProtocol;
  listedOnly: boolean;
  /** What this page was paged from — see {@link TokenListSource}. */
  source: TokenListSource;
  results: TokenSummary[];
  /** How many rows exist in {@link source}, not in the protocol as a whole. */
  total: number;
  offset: number;
  limit: number;
  /** Whether the rows could be named by their own protocol. */
  hydration: TokenHydrationStatus;
  /**
   * Whether the rows carry every picture that exists for them. `partial` means
   * some kept their placeholder because the server's artwork pass ran out of
   * time — a reason to re-read, not a reason to warn. See
   * {@link TokenArtworkStatus}.
   */
  artwork: TokenArtworkStatus;
  /**
   * Outcome of the offer aggregate that priced this page. On `error` every row
   * comes back `listed: false` with no floor price — indistinguishable from a
   * page where nothing happens to be listed, hence the flag.
   */
  offers: TokenOfferAggregateStatus;
}

/** A token's identity: everything needed to address one of the five endpoints. */
export interface TokenRef {
  protocol: TokenProtocol;
  /**
   * Canonical id. Ignored for `zeld` and `kontor`, whose endpoints name their
   * single token in the path.
   */
  id: string;
}

export interface TokenChartParams {
  /** Preset window. Mutually exclusive with {@link from}/{@link to}. */
  range?: TokenChartRange;
  /** RFC 3339. Must be passed together with {@link to}. */
  from?: string;
  to?: string;
}

export interface TokenActivityParams {
  offset?: number;
  limit?: number;
}

export interface TokenSearchParams {
  /** The search term. Trimmed by the server; 1–128 characters. */
  query: string;
  /** Page size, capped at 50 by the server. Defaults to 20. */
  limit?: number;
  /** Restrict the search to these protocols. Empty/omitted searches all five. */
  protocols?: TokenProtocol[];
  /** Only tokens with at least one open offer. */
  listedOnly?: boolean;
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function mapValue(wire: WireTokenValue): TokenValue {
  return {
    type: wire.type,
    value: wire.value,
    unit: wire.unit,
    subLabel: wire.sub_label,
    url: wire.url,
    tone: wire.tone,
  };
}

function mapStat(wire: WireTokenStat): TokenStat {
  return { key: wire.key, label: wire.label, value: mapValue(wire.value) };
}

function mapProperty(wire: WireTokenProperty): TokenProperty {
  return { ...mapStat(wire), group: wire.group };
}

function mapMedia(wire: WireTokenMedia): TokenMedia {
  return {
    kind: wire.kind,
    imageUrl: wire.image_url,
    imageLargeUrl: wire.image_large_url,
    imageIsPlaceholder: wire.image_is_placeholder,
    thumbnailUrl: wire.thumbnail_url,
    contentUrl: wire.content_url,
    contentType: wire.content_type,
    audioUrl: wire.audio_url,
    videoUrl: wire.video_url,
    embedUrl: wire.embed_url,
    embedHeight: wire.embed_height,
  };
}

function mapMarket(wire: WireTokenMarket | null): TokenMarket | null {
  if (!wire) return null;
  return {
    quoteAsset: wire.quote_asset,
    lastPriceSats: wire.last_price_sats,
    floorPriceSats: wire.floor_price_sats,
    marketCapSats: wire.market_cap_sats,
    volumeSats: wire.volume_sats,
    priceChangePercent: wire.price_change_percent,
    holders: wire.holders,
    supply: wire.supply,
    supplyLocked: wire.supply_locked,
    divisible: wire.divisible,
    tradeCount: wire.trade_count,
  };
}

function mapOffers(wire: WireTokenOffers): TokenOffers {
  return {
    count: wire.count,
    floorPriceSats: wire.floor_price_sats,
    webUrl: wire.web_url,
    atomicSwapsQuery: wire.atomic_swaps_query,
  };
}

/**
 * Every section, as a map rather than a list so the compiler enforces
 * exhaustiveness: a member added to {@link TokenSection} fails to compile here
 * instead of silently reopening the hole {@link mapCapabilities} exists to fill
 * — a key a caller reads back as `undefined`.
 */
const TOKEN_SECTIONS: Record<TokenSection, true> = {
  chart: true,
  activity: true,
  holders: true,
  attributes: true,
  transactions: true,
};

/**
 * `capabilities` with every section present.
 *
 * The two fields say the same thing twice, and a client reads whichever suits
 * it — so a payload that ships one without the other must not leave the map
 * with holes a caller reads as `undefined`.
 */
function mapCapabilities(
  capabilities: Record<TokenSection, boolean> | undefined,
  availableSections: TokenSection[],
): Record<TokenSection, boolean> {
  const mapped = {} as Record<TokenSection, boolean>;
  for (const section of Object.keys(TOKEN_SECTIONS) as TokenSection[]) {
    mapped[section] =
      capabilities?.[section] ?? availableSections.includes(section);
  }
  return mapped;
}

function mapDetail(wire: WireTokenDetail): TokenDetail {
  const availableSections = wire.available_sections ?? [];
  return {
    protocol: wire.protocol,
    protocolLabel: wire.protocol_label,
    id: wire.id,
    canonicalId: wire.canonical_id,
    network: wire.network,
    name: wire.name,
    subtitle: wire.subtitle,
    tagline: wire.tagline,
    description: wire.description,
    media: mapMedia(wire.media),
    stats: (wire.stats ?? []).map(mapStat),
    properties: (wire.properties ?? []).map(mapProperty),
    attributes: wire.attributes ?? [],
    market: mapMarket(wire.market),
    offers: mapOffers(wire.offers),
    links: wire.links ?? [],
    collection: wire.collection
      ? {
          name: wire.collection.name,
          slug: wire.collection.slug,
          webUrl: wire.collection.web_url,
        }
      : null,
    issuer: wire.issuer
      ? {
          address: wire.issuer.address,
          username: wire.issuer.username,
          profileUrl: wire.issuer.profile_url,
          royaltyPercent: wire.issuer.royalty_percent,
        }
      : null,
    capabilities: mapCapabilities(wire.capabilities, availableSections),
    availableSections,
    chart: wire.chart
      ? {
          defaultRange: wire.chart.default_range,
          ranges: wire.chart.ranges,
          url: wire.chart.url,
        }
      : null,
    webUrl: wire.web_url,
    generatedAt: wire.generated_at,
  };
}

function mapChart(wire: WireTokenChart): TokenChart {
  return {
    range: wire.range,
    from: wire.from,
    to: wire.to,
    intervalSeconds: wire.interval_seconds,
    intervalLabel: wire.interval_label,
    quoteAsset: wire.quote_asset,
    priceUnit: wire.price_unit,
    volumeUnit: wire.volume_unit,
    tradeCount: wire.trade_count,
    points: (wire.points ?? []).map((point) => ({
      time: point.time,
      price: point.price,
      volume: point.volume,
      type: point.type,
    })),
  };
}

function mapActivityPage(wire: WireTokenActivityPage): TokenActivityPage {
  return {
    items: (wire.activity ?? []).map((item) => ({
      time: item.time,
      eventType: item.event_type,
      priceSats: item.price_sats,
      quantity: item.quantity,
      buyerAddress: item.buyer_address,
      sellerAddress: item.seller_address,
      txid: item.txid,
    })),
    total: wire.pagination?.total ?? 0,
    offset: wire.pagination?.offset ?? 0,
    limit: wire.pagination?.limit ?? null,
  };
}

function mapSummary(wire: WireTokenSummary): TokenSummary {
  return {
    protocol: wire.protocol,
    protocolLabel: wire.protocol_label,
    id: wire.id,
    canonicalId: wire.canonical_id,
    network: wire.network,
    name: wire.name,
    subtitle: wire.subtitle,
    imageUrl: wire.image_url,
    imageIsPlaceholder: wire.image_is_placeholder,
    thumbnailUrl: wire.thumbnail_url,
    floorPriceSats: wire.floor_price_sats,
    offersCount: wire.offers_count,
    listed: wire.listed,
    collection: wire.collection,
    apiUrl: wire.api_url,
    webUrl: wire.web_url,
  };
}

function mapSearchSummary(wire: WireTokenSearchSummary): TokenSearchSummary {
  return { ...mapSummary(wire), match: wire.match };
}

function mapListResult(wire: WireTokenListResult): TokenListPage {
  return {
    protocol: wire.protocol,
    listedOnly: wire.listed_only,
    source: wire.source,
    results: (wire.results ?? []).map(mapSummary),
    total: wire.pagination?.total ?? 0,
    offset: wire.pagination?.offset ?? 0,
    limit: wire.pagination?.limit ?? 0,
    // A server that ships none of these has not degraded — it predates them.
    hydration: wire.hydration ?? "ok",
    artwork: wire.artwork ?? "ok",
    offers: wire.offers ?? "ok",
  };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/**
 * The `/api/tokens/*` path for one token — the single place the five URL shapes
 * live, so the detail, chart and activity calls can never address different
 * tokens.
 *
 * ZELD and KOR name their token in the path, so their `id` is ignored: there is
 * exactly one of each, and `client.getToken({ protocol: "zeld", id: "" })` is
 * as valid as passing `"ZELD"`.
 */
export function tokenApiPath(protocol: TokenProtocol, id: string): string {
  switch (protocol) {
    case "counterparty":
      return `/api/tokens/counterparty/${encodeURIComponent(id)}`;
    case "zeld":
      return "/api/tokens/ZELD";
    case "ordinals":
      return `/api/tokens/ordinals/${encodeURIComponent(id)}`;
    case "kontor":
      return "/api/tokens/kontor/KOR";
    case "kontor-nft":
      return `/api/tokens/kontor/nfts/${encodeURIComponent(id)}`;
  }
}

/**
 * The token a listing is selling, or `null` when the listing does not name one
 * (a hand-built fixture, or a Kontor NFT row with no id) — in which case a
 * caller should render the asset name as plain, unlinked text.
 *
 * Counterparty subassets resolve to their longname where there is one: it is the
 * documented detail-route form, and the server resolves it to the canonical
 * `A…` name itself.
 */
export function tokenRefFromSwap(swap: AtomicSwap): TokenRef | null {
  switch (swap.listingType) {
    case "zeld":
      return { protocol: "zeld", id: "ZELD" };
    case "ordinal":
      // Ordinal listings store the inscription id as their asset name.
      return swap.assetName ? { protocol: "ordinals", id: swap.assetName } : null;
    case "kontor":
      if (swap.kontorAssetKind === "nft") {
        return swap.kontorNftId
          ? { protocol: "kontor-nft", id: swap.kontorNftId }
          : null;
      }
      return { protocol: "kontor", id: "KOR" };
    case "counterparty": {
      const name = swap.assetLongname ?? swap.assetName;
      return name ? { protocol: "counterparty", id: name } : null;
    }
    default:
      return null;
  }
}

// ─── Requests ────────────────────────────────────────────────────────────────

/** Read the `{ error }` message off a non-2xx raw response. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string } | null;
    if (body?.error) return body.error;
  } catch {
    // not JSON / empty body
  }
  return response.statusText || "Unknown error";
}

/**
 * GET a public token resource, unwrapping the `{ data }` envelope and answering
 * `null` on 404.
 *
 * 404 is an ordinary answer here, not a failure: an unknown asset, a token type
 * the responding network does not serve (Kontor is signet-only), or a token with
 * no chart all report it.
 */
async function getOrNull<TWire, TResult>(
  http: HttpClient,
  path: string,
  map: (wire: TWire) => TResult,
  signal?: AbortSignal,
): Promise<TResult | null> {
  const response = await http.fetchRaw("GET", path, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new HorizonMarketApiError(
      response.status,
      await readErrorMessage(response),
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: TWire;
  } | null;
  if (!payload?.data) {
    throw new HorizonMarketApiError(
      response.status,
      "Response missing required { data } envelope",
    );
  }
  return map(payload.data);
}

/**
 * `GET /api/tokens/{protocol}/{id}` — one token's full detail payload, or `null`
 * when this network serves no such token.
 */
export async function getToken(
  http: HttpClient,
  ref: TokenRef,
  options?: RequestOptions,
): Promise<TokenDetail | null> {
  return getOrNull<WireTokenDetail, TokenDetail>(
    http,
    tokenApiPath(ref.protocol, ref.id),
    mapDetail,
    options?.signal,
  );
}

/**
 * `GET /api/tokens/{protocol}/{id}/chart` — a bucketed price/volume series.
 *
 * Pass either {@link TokenChartParams.range} or both `from` and `to`; passing
 * both forms is a 400. Defaults to the `1M` range. `null` when the token has no
 * chart at all — a Kontor NFT is one of a kind, so there is no series to draw
 * (`capabilities.chart` says so up front).
 */
export async function getTokenChart(
  http: HttpClient,
  ref: TokenRef,
  params?: TokenChartParams,
  options?: RequestOptions,
): Promise<TokenChart | null> {
  const qs = new URLSearchParams();
  if (params?.range) qs.set("range", params.range);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const query = qs.toString();

  return getOrNull<WireTokenChart, TokenChart>(
    http,
    `${tokenApiPath(ref.protocol, ref.id)}/chart${query ? `?${query}` : ""}`,
    mapChart,
    options?.signal,
  );
}

/**
 * `GET /api/tokens/{protocol}/{id}/activity` — completed sales, newest first.
 *
 * An unknown token (or one with no activity resource) answers with an empty
 * page rather than throwing, so a caller can render the section unconditionally.
 */
export async function getTokenActivity(
  http: HttpClient,
  ref: TokenRef,
  params?: TokenActivityParams,
  options?: RequestOptions,
): Promise<TokenActivityPage> {
  const qs = new URLSearchParams();
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  const query = qs.toString();

  const page = await getOrNull<WireTokenActivityPage, TokenActivityPage>(
    http,
    `${tokenApiPath(ref.protocol, ref.id)}/activity${query ? `?${query}` : ""}`,
    mapActivityPage,
    options?.signal,
  );
  return (
    page ?? {
      items: [],
      total: 0,
      offset: params?.offset ?? 0,
      limit: params?.limit ?? null,
    }
  );
}

/**
 * `GET /api/tokens/search` — one autocomplete across all five token types.
 *
 * Every result carries an {@link TokenSummary.apiUrl} and enough identity
 * ({@link TokenSummary.protocol} + {@link TokenSummary.id}) to be handed straight
 * to {@link getToken}, so a client goes from a keystroke to a token screen
 * without knowing any protocol's URL shape.
 *
 * There is no `offset`: five independently-ranked sources cannot be paged
 * coherently. Raise `limit` (max 50) and read
 * {@link TokenSearchResult.truncated} instead.
 *
 * Two limits worth surfacing in a UI: a Kontor NFT is findable by its `nft_id`
 * only (its display name lives on the Kontor Portal and is not indexed), and an
 * inscription by number or id — neither has a searchable on-chain name.
 */
export async function searchTokens(
  http: HttpClient,
  params: TokenSearchParams,
  options?: RequestOptions,
): Promise<TokenSearchResult> {
  const qs = new URLSearchParams({ q: params.query });
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.protocols?.length) qs.set("protocols", params.protocols.join(","));
  if (params.listedOnly) qs.set("listed_only", "true");

  const wire = await http.request<WireTokenSearchResult>(
    "GET",
    `/api/tokens/search?${qs.toString()}`,
    undefined,
    options?.signal,
  );
  return {
    query: wire.query,
    results: (wire.results ?? []).map(mapSearchSummary),
    truncated: wire.truncated,
    sources: wire.sources ?? {},
    offers: wire.offers,
  };
}

/**
 * `GET /api/tokens` — one page of one protocol's tokens, in the same row shape
 * {@link searchTokens} returns. This is the browse surface: a grid whose rows
 * each carry an {@link TokenSummary.apiUrl}, so a tile becomes a token screen
 * with no client-side knowledge of any protocol's URL shape.
 *
 * `null` when this network does not serve the protocol at all — Kontor NFTs
 * asked of a mainnet host. Deliberately not an empty page: a client would page
 * through that forever with no way to tell "no NFTs" from "not here".
 *
 * One protocol per call, and no merged feed: three catalogues ordered by three
 * unrelated things (issuance height, inscription order, mint order) cannot be
 * interleaved into a list that pages coherently — page 2 would be computed from
 * a different merge than page 1 the moment any upstream moved.
 *
 * Read {@link TokenListPage.source} before promising depth: an Ordinals page is
 * a cron-warmed *window* of recent inscriptions, not the whole catalogue.
 */
export async function listTokens(
  http: HttpClient,
  params: TokenListParams,
  options?: RequestOptions,
): Promise<TokenListPage | null> {
  const qs = new URLSearchParams({ protocol: params.protocol });
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.listedOnly) qs.set("listed_only", "true");

  return getOrNull<WireTokenListResult, TokenListPage>(
    http,
    `/api/tokens?${qs.toString()}`,
    mapListResult,
    options?.signal,
  );
}
