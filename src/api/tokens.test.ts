import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  getToken,
  getTokenActivity,
  getTokenChart,
  listTokens,
  searchTokens,
  tokenApiPath,
  tokenRefFromSwap,
} from "./tokens.js";
import { makeFetch } from "../test-utils.js";
import type { AtomicSwap } from "../types/index.js";

// ─── Fixtures / helpers ──────────────────────────────────────────────────────

const WIRE_DETAIL = {
  protocol: "counterparty",
  protocol_label: "Counterparty",
  id: "RAREPEPE",
  canonical_id: "counterparty:RAREPEPE",
  network: "mainnet",
  name: "RAREPEPE",
  subtitle: "Rare Pepes",
  tagline: null,
  description: null,
  media: {
    kind: "image",
    image_url: "https://example.com/img.png",
    image_large_url: "https://example.com/img-large.png",
    image_is_placeholder: false,
    thumbnail_url: null,
    content_url: null,
    content_type: null,
    audio_url: null,
    video_url: null,
    embed_url: null,
    embed_height: null,
  },
  stats: [
    {
      key: "volume",
      label: "Volume",
      value: {
        type: "sats",
        value: 17_279_428_885,
        unit: "BTC",
        sub_label: null,
        url: null,
        tone: null,
      },
    },
  ],
  properties: [
    {
      group: "overview",
      key: "artist",
      label: "Artist",
      value: {
        type: "text",
        value: "Mike",
        unit: null,
        sub_label: null,
        url: null,
        tone: null,
      },
    },
  ],
  attributes: [{ name: "Rarity", value: "Rare" }],
  market: {
    quote_asset: "BTC",
    last_price_sats: 260_544_385,
    floor_price_sats: null,
    market_cap_sats: 77_642_226_730,
    volume_sats: 17_279_428_885,
    price_change_percent: null,
    holders: 208,
    supply: "298",
    supply_locked: true,
    divisible: false,
    trade_count: 54,
  },
  offers: {
    count: 2,
    floor_price_sats: 120_000,
    web_url: "https://example.com/assets/RAREPEPE",
    atomic_swaps_query: {
      funded: "true",
      asset_name: "RAREPEPE",
      listing_type: "counterparty",
    },
  },
  links: [{ kind: "x", label: "X", url: "https://x.com/rarepepe" }],
  collection: {
    name: "Rare Pepes",
    slug: "rare-pepes",
    web_url: "https://example.com/collections/rare-pepes",
  },
  issuer: {
    address: "1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD",
    username: null,
    profile_url: null,
    royalty_percent: null,
  },
  capabilities: {
    chart: true,
    activity: true,
    holders: true,
    attributes: false,
    transactions: false,
  },
  available_sections: ["chart", "activity", "holders"],
  chart: {
    default_range: "1M",
    ranges: ["1W", "1M", "1Y", "max"],
    url: "https://example.com/api/tokens/counterparty/RAREPEPE/chart",
  },
  web_url: "https://example.com/assets/RAREPEPE",
  generated_at: "2026-08-10T07:28:28.253Z",
};

const WIRE_SUMMARY = {
  protocol: "counterparty",
  protocol_label: "Counterparty",
  id: "PEPECASH",
  canonical_id: "counterparty:PEPECASH",
  network: "mainnet",
  name: "PEPECASH",
  subtitle: "Rare Pepes",
  image_url: "https://example.com/pepecash.jpg",
  image_is_placeholder: false,
  thumbnail_url: null,
  floor_price_sats: 5_000,
  offers_count: 3,
  listed: true,
  collection: { name: "Rare Pepes", slug: "rare-pepes" },
  api_url: "https://example.com/api/tokens/counterparty/PEPECASH",
  web_url: "https://example.com/assets/PEPECASH",
  match: { field: "name", kind: "prefix" },
};

function http(fetchFn: typeof globalThis.fetch): HttpClient {
  return new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
}

/** A raw (non-enveloped) response with real Headers — for the `fetchRaw` paths. */
function rawResponse(
  status: number,
  json?: unknown,
  statusText = "OK",
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    headers: new Headers(),
    json: () =>
      json === undefined
        ? Promise.reject(new Error("not json"))
        : Promise.resolve(json),
  } as unknown as Response;
}

function makeRawFetch(...responses: Response[]): typeof globalThis.fetch {
  let call = 0;
  return vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(responses[call++] ?? responses[responses.length - 1]),
    );
}

function lastUrl(fetchFn: typeof globalThis.fetch): string {
  const mock = fetchFn as ReturnType<typeof vi.fn>;
  return (mock.mock.calls[mock.mock.calls.length - 1] as [string])[0];
}

function swap(overrides: Partial<AtomicSwap>): AtomicSwap {
  return {
    id: "swap-1",
    listingType: "counterparty",
    sellerAddress: "bc1qseller",
    buyerAddress: null,
    assetUtxoId: null,
    assetUtxoValue: null,
    assetName: null,
    assetQuantity: null,
    price: 1000,
    pricePerUnit: null,
    psbtHex: null,
    txId: null,
    blockIndex: null,
    funded: true,
    filled: false,
    confirmed: true,
    delisted: false,
    sellerDelisted: false,
    expired: false,
    pending: false,
    anomalous: false,
    royalty: null,
    expiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    onChainPayment: null,
    imageUrl: null,
    thumbnailUrl: null,
    inscriptionNumber: null,
    assetDivisibility: null,
    kontorOfferBlob: null,
    kontorAssetKind: null,
    kontorContractAddress: null,
    kontorNftId: null,
    kontorAmount: null,
    pendingRole: null,
    pendingTxid: null,
    ...overrides,
  };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

describe("tokenApiPath", () => {
  it("builds one path per protocol", () => {
    expect(tokenApiPath("counterparty", "RAREPEPE")).toBe(
      "/api/tokens/counterparty/RAREPEPE",
    );
    expect(tokenApiPath("ordinals", "abc123i0")).toBe(
      "/api/tokens/ordinals/abc123i0",
    );
    expect(tokenApiPath("kontor-nft", "nft-7")).toBe(
      "/api/tokens/kontor/nfts/nft-7",
    );
  });

  it("names the single token in the path for ZELD and KOR, ignoring the id", () => {
    expect(tokenApiPath("zeld", "ZELD")).toBe("/api/tokens/ZELD");
    expect(tokenApiPath("zeld", "")).toBe("/api/tokens/ZELD");
    expect(tokenApiPath("kontor", "KOR")).toBe("/api/tokens/kontor/KOR");
    expect(tokenApiPath("kontor", "anything")).toBe("/api/tokens/kontor/KOR");
  });

  it("encodes the id segment so it can never rewrite the path", () => {
    // A subasset longname is case-sensitive and legal; a slash is not part of
    // any id and must not reach the server as a path separator.
    expect(tokenApiPath("counterparty", "PEPENARDO.card")).toBe(
      "/api/tokens/counterparty/PEPENARDO.card",
    );
    expect(tokenApiPath("counterparty", "A/B")).toBe(
      "/api/tokens/counterparty/A%2FB",
    );
  });
});

// ─── tokenRefFromSwap ────────────────────────────────────────────────────────

describe("tokenRefFromSwap", () => {
  it("maps a Counterparty listing by name", () => {
    expect(
      tokenRefFromSwap(swap({ listingType: "counterparty", assetName: "RAREPEPE" })),
    ).toEqual({ protocol: "counterparty", id: "RAREPEPE" });
  });

  it("prefers a subasset longname over the numeric A… name", () => {
    expect(
      tokenRefFromSwap(
        swap({
          listingType: "counterparty",
          assetName: "A9876543210",
          assetLongname: "PEPENARDO.CARD",
        }),
      ),
    ).toEqual({ protocol: "counterparty", id: "PEPENARDO.CARD" });
  });

  it("maps an ordinal listing through its asset name (the inscription id)", () => {
    expect(
      tokenRefFromSwap(swap({ listingType: "ordinal", assetName: "abc123i0" })),
    ).toEqual({ protocol: "ordinals", id: "abc123i0" });
  });

  it("maps ZELD and KOR to their fixed ids", () => {
    expect(tokenRefFromSwap(swap({ listingType: "zeld" }))).toEqual({
      protocol: "zeld",
      id: "ZELD",
    });
    expect(
      tokenRefFromSwap(swap({ listingType: "kontor", kontorAssetKind: "token" })),
    ).toEqual({ protocol: "kontor", id: "KOR" });
  });

  it("maps a Kontor NFT listing to kontor-nft", () => {
    expect(
      tokenRefFromSwap(
        swap({
          listingType: "kontor",
          kontorAssetKind: "nft",
          kontorNftId: "nft-7",
        }),
      ),
    ).toEqual({ protocol: "kontor-nft", id: "nft-7" });
  });

  it("returns null when the listing names no token", () => {
    // Nothing to link to — the caller renders the name as plain text.
    expect(
      tokenRefFromSwap(swap({ listingType: "counterparty", assetName: null })),
    ).toBeNull();
    expect(
      tokenRefFromSwap(swap({ listingType: "ordinal", assetName: null })),
    ).toBeNull();
    expect(
      tokenRefFromSwap(
        swap({ listingType: "kontor", kontorAssetKind: "nft", kontorNftId: null }),
      ),
    ).toBeNull();
  });
});

// ─── getToken ────────────────────────────────────────────────────────────────

describe("getToken", () => {
  it("unwraps the envelope and camelCases the payload", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_DETAIL }));

    const token = await getToken(http(fetchFn), {
      protocol: "counterparty",
      id: "RAREPEPE",
    });

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/counterparty/RAREPEPE",
    );
    expect(token).not.toBeNull();
    expect(token?.canonicalId).toBe("counterparty:RAREPEPE");
    expect(token?.protocolLabel).toBe("Counterparty");
    expect(token?.media.imageLargeUrl).toBe("https://example.com/img-large.png");
    expect(token?.media.imageIsPlaceholder).toBe(false);
    expect(token?.market?.marketCapSats).toBe(77_642_226_730);
    // A decimal string, never coerced to a number.
    expect(token?.market?.supply).toBe("298");
    expect(token?.offers.atomicSwapsQuery).toEqual({
      funded: "true",
      asset_name: "RAREPEPE",
      listing_type: "counterparty",
    });
    expect(token?.collection).toEqual({
      name: "Rare Pepes",
      slug: "rare-pepes",
      webUrl: "https://example.com/collections/rare-pepes",
    });
    expect(token?.chart?.defaultRange).toBe("1M");
    expect(token?.availableSections).toEqual(["chart", "activity", "holders"]);
  });

  it("camelCases nested stat and property values", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_DETAIL }));
    const token = await getToken(http(fetchFn), {
      protocol: "counterparty",
      id: "RAREPEPE",
    });

    expect(token?.stats[0]).toEqual({
      key: "volume",
      label: "Volume",
      value: {
        type: "sats",
        value: 17_279_428_885,
        unit: "BTC",
        subLabel: null,
        url: null,
        tone: null,
      },
    });
    expect(token?.properties[0]?.group).toBe("overview");
  });

  it("maps a payload with no market, collection, issuer, chart or lists", async () => {
    // A Kontor NFT: one of a kind, so no fungible market and no price series —
    // and every optional list simply absent rather than empty.
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        data: {
          ...WIRE_DETAIL,
          protocol: "kontor-nft",
          market: null,
          collection: null,
          issuer: null,
          chart: null,
          stats: undefined,
          properties: undefined,
          attributes: undefined,
          links: undefined,
        },
      }),
    );
    const token = await getToken(http(fetchFn), {
      protocol: "kontor-nft",
      id: "nft-7",
    });

    expect(token?.market).toBeNull();
    expect(token?.collection).toBeNull();
    expect(token?.issuer).toBeNull();
    expect(token?.chart).toBeNull();
    // Absent, not empty, on the wire — a caller must still get an array it can
    // map over without a guard of its own.
    expect(token?.stats).toEqual([]);
    expect(token?.properties).toEqual([]);
    expect(token?.attributes).toEqual([]);
    expect(token?.links).toEqual([]);
  });

  it("falls back to the status text when the error body carries no message", async () => {
    // `rawResponse` with no json rejects the body parse — the same shape an
    // empty or HTML error page has.
    const fetchFn = makeRawFetch(rawResponse(503, undefined, "Bad Gateway"));
    await expect(
      getToken(http(fetchFn), { protocol: "zeld", id: "ZELD" }),
    ).rejects.toThrow("Bad Gateway");
  });

  it("falls back again when even the status text is empty", async () => {
    const fetchFn = makeRawFetch(rawResponse(500, { notAnError: true }, ""));
    await expect(
      getToken(http(fetchFn), { protocol: "zeld", id: "ZELD" }),
    ).rejects.toThrow("Unknown error");
  });

  it("fills capabilities from availableSections when the payload omits them", async () => {
    // The two fields say the same thing twice and a client reads whichever suits
    // it, so a payload shipping only one must not leave the map with holes a
    // caller would read as `undefined` (i.e. as "no chart").
    const { capabilities: _dropped, ...withoutCapabilities } = WIRE_DETAIL;
    void _dropped;
    const fetchFn = makeRawFetch(rawResponse(200, { data: withoutCapabilities }));
    const token = await getToken(http(fetchFn), {
      protocol: "counterparty",
      id: "RAREPEPE",
    });

    expect(token?.capabilities).toEqual({
      chart: true,
      activity: true,
      holders: true,
      attributes: false,
      transactions: false,
    });
  });

  it("keeps every section defined when both fields are absent", async () => {
    const {
      capabilities: _caps,
      available_sections: _sections,
      ...bare
    } = WIRE_DETAIL;
    void _caps;
    void _sections;
    const fetchFn = makeRawFetch(rawResponse(200, { data: bare }));
    const token = await getToken(http(fetchFn), {
      protocol: "counterparty",
      id: "RAREPEPE",
    });

    expect(token?.availableSections).toEqual([]);
    expect(Object.values(token!.capabilities)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("returns null on 404 — an unknown token, or one this network doesn't serve", async () => {
    const fetchFn = makeRawFetch(rawResponse(404, { error: "Token not found" }));
    await expect(
      getToken(http(fetchFn), { protocol: "kontor", id: "KOR" }),
    ).resolves.toBeNull();
  });

  it("throws on other failures", async () => {
    const fetchFn = makeRawFetch(rawResponse(500, { error: "boom" }));
    await expect(
      getToken(http(fetchFn), { protocol: "zeld", id: "ZELD" }),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
  });

  it("throws when the envelope is missing", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { nope: true }));
    await expect(
      getToken(http(fetchFn), { protocol: "zeld", id: "ZELD" }),
    ).rejects.toThrow(/\{ data \} envelope/);
  });
});

// ─── getTokenChart ───────────────────────────────────────────────────────────

describe("getTokenChart", () => {
  const WIRE_CHART = {
    range: "1M",
    from: "2026-07-10T00:00:00.000Z",
    to: "2026-08-10T07:25:00.000Z",
    interval_seconds: 14_400,
    interval_label: "4 hours",
    quote_asset: "BTC",
    price_unit: "sats",
    volume_unit: "RAREPEPE",
    trade_count: 2,
    points: [
      { time: "2026-07-10T00:00:00.000Z", price: 100, volume: 1, type: "trade" },
    ],
  };

  it("requests the range and maps the series", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_CHART }));

    const chart = await getTokenChart(
      http(fetchFn),
      { protocol: "counterparty", id: "RAREPEPE" },
      { range: "1M" },
    );

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/counterparty/RAREPEPE/chart?range=1M",
    );
    expect(chart?.intervalSeconds).toBe(14_400);
    expect(chart?.intervalLabel).toBe("4 hours");
    expect(chart?.volumeUnit).toBe("RAREPEPE");
    expect(chart?.points).toEqual([
      { time: "2026-07-10T00:00:00.000Z", price: 100, volume: 1, type: "trade" },
    ]);
  });

  it("sends an explicit window when given one", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_CHART }));
    await getTokenChart(
      http(fetchFn),
      { protocol: "zeld", id: "ZELD" },
      { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
    );
    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/ZELD/chart?from=2026-01-01T00%3A00%3A00Z&to=2026-02-01T00%3A00%3A00Z",
    );
  });

  it("omits the query string entirely when no window is given", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_CHART }));
    await getTokenChart(http(fetchFn), { protocol: "kontor", id: "KOR" });
    expect(lastUrl(fetchFn)).toBe("https://example.com/api/tokens/kontor/KOR/chart");
  });

  it("maps a series whose points array is absent", async () => {
    const { points: _points, ...noPoints } = WIRE_CHART;
    void _points;
    const fetchFn = makeRawFetch(rawResponse(200, { data: noPoints }));
    const chart = await getTokenChart(http(fetchFn), {
      protocol: "zeld",
      id: "ZELD",
    });
    expect(chart?.points).toEqual([]);
  });

  it("returns null for a token with no chart", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(404, { error: "This token has no chart" }),
    );
    await expect(
      getTokenChart(http(fetchFn), { protocol: "kontor-nft", id: "nft-7" }),
    ).resolves.toBeNull();
  });
});

// ─── getTokenActivity ────────────────────────────────────────────────────────

describe("getTokenActivity", () => {
  const WIRE_ACTIVITY = {
    activity: [
      {
        time: "2026-08-01T00:00:00.000Z",
        event_type: "sale",
        price_sats: 120_000,
        quantity: "1",
        buyer_address: "bc1qbuyer",
        seller_address: "bc1qseller",
        txid: "a".repeat(64),
      },
    ],
    pagination: { total: 9, offset: 0, limit: 20 },
  };

  it("maps the page and its pagination", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_ACTIVITY }));

    const page = await getTokenActivity(
      http(fetchFn),
      { protocol: "counterparty", id: "RAREPEPE" },
      { offset: 0, limit: 20 },
    );

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/counterparty/RAREPEPE/activity?offset=0&limit=20",
    );
    expect(page.total).toBe(9);
    expect(page.items[0]).toEqual({
      time: "2026-08-01T00:00:00.000Z",
      eventType: "sale",
      priceSats: 120_000,
      quantity: "1",
      buyerAddress: "bc1qbuyer",
      sellerAddress: "bc1qseller",
      txid: "a".repeat(64),
    });
  });

  it("omits the query string when no paging params are given", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: WIRE_ACTIVITY }));
    await getTokenActivity(http(fetchFn), { protocol: "zeld", id: "ZELD" });
    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/ZELD/activity",
    );
  });

  it("echoes the requested window back on the empty 404 page", async () => {
    // So a caller's "showing 0 of 0 from offset N" stays truthful.
    const fetchFn = makeRawFetch(rawResponse(404, { error: "Token not found" }));
    const page = await getTokenActivity(
      http(fetchFn),
      { protocol: "kontor-nft", id: "nft-7" },
      { offset: 60, limit: 30 },
    );
    expect(page).toEqual({ items: [], total: 0, offset: 60, limit: 30 });
  });

  it("defaults a page whose activity and pagination are absent", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: {} }));
    const page = await getTokenActivity(http(fetchFn), {
      protocol: "zeld",
      id: "ZELD",
    });
    expect(page).toEqual({ items: [], total: 0, offset: 0, limit: null });
  });

  it("answers an empty page on 404 rather than throwing", async () => {
    // The caller renders the section unconditionally; a token with no activity
    // resource must not blow up the screen.
    const fetchFn = makeRawFetch(rawResponse(404, { error: "Token not found" }));
    await expect(
      getTokenActivity(
        http(fetchFn),
        { protocol: "kontor-nft", id: "nft-7" },
        { offset: 40, limit: 20 },
      ),
    ).resolves.toEqual({ items: [], total: 0, offset: 40, limit: 20 });
  });
});

// ─── searchTokens ────────────────────────────────────────────────────────────

describe("searchTokens", () => {
  it("maps results and reports per-source health", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        query: "PEPE",
        results: [WIRE_SUMMARY],
        truncated: true,
        sources: {
          counterparty: "ok",
          zeld: "ok",
          ordinals: "timeout",
          kontor: "skipped",
          "kontor-nft": "skipped",
        },
        offers: "ok",
      },
    });

    const result = await searchTokens(http(fetchFn), { query: "PEPE" });

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/search?q=PEPE",
    );
    expect(result.truncated).toBe(true);
    expect(result.sources.ordinals).toBe("timeout");
    expect(result.results[0]).toEqual({
      protocol: "counterparty",
      protocolLabel: "Counterparty",
      id: "PEPECASH",
      canonicalId: "counterparty:PEPECASH",
      network: "mainnet",
      name: "PEPECASH",
      subtitle: "Rare Pepes",
      imageUrl: "https://example.com/pepecash.jpg",
      imageIsPlaceholder: false,
      thumbnailUrl: null,
      floorPriceSats: 5_000,
      offersCount: 3,
      listed: true,
      collection: { name: "Rare Pepes", slug: "rare-pepes" },
      apiUrl: "https://example.com/api/tokens/counterparty/PEPECASH",
      webUrl: "https://example.com/assets/PEPECASH",
      match: { field: "name", kind: "prefix" },
    });
  });

  it("defaults an answer whose results and sources are absent", async () => {
    const fetchFn = makeFetch(200, {
      data: { query: "ZZZ", truncated: false, offers: "ok" },
    });
    const result = await searchTokens(http(fetchFn), { query: "ZZZ" });
    expect(result.results).toEqual([]);
    expect(result.sources).toEqual({});
  });

  it("a result's id addresses its own detail endpoint", async () => {
    // The whole point of the search payload: a hit nobody can open is useless.
    const fetchFn = makeFetch(200, {
      data: {
        query: "PEPE",
        results: [WIRE_SUMMARY],
        truncated: false,
        sources: {},
        offers: "ok",
      },
    });
    const { results } = await searchTokens(http(fetchFn), { query: "PEPE" });
    const hit = results[0]!;
    expect(`https://example.com${tokenApiPath(hit.protocol, hit.id)}`).toBe(
      hit.apiUrl,
    );
  });

  it("passes limit, protocols and listed_only", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        query: "KOR",
        results: [],
        truncated: false,
        sources: {},
        offers: "ok",
      },
    });

    await searchTokens(http(fetchFn), {
      query: "KOR",
      limit: 50,
      protocols: ["kontor", "kontor-nft"],
      listedOnly: true,
    });

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/search?q=KOR&limit=50&protocols=kontor%2Ckontor-nft&listed_only=true",
    );
  });

  it("omits the optional params when unset", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        query: "a b",
        results: [],
        truncated: false,
        sources: {},
        offers: "ok",
      },
    });
    await searchTokens(http(fetchFn), {
      query: "a b",
      protocols: [],
      listedOnly: false,
    });
    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens/search?q=a+b",
    );
  });

  it("propagates a rejected query", async () => {
    const fetchFn = makeFetch(400, { error: "q must not be empty" });
    await expect(
      searchTokens(http(fetchFn), { query: " " }),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
  });
});

// ─── listTokens ──────────────────────────────────────────────────────────────

/** A browse row: the search row minus its `match`, which browse never sends. */
const { match: searchOnly, ...WIRE_ROW } = WIRE_SUMMARY;
void searchOnly;

function listPage(overrides: Record<string, unknown> = {}) {
  return {
    protocol: "counterparty",
    listed_only: false,
    source: "catalogue",
    results: [WIRE_ROW],
    pagination: { total: 4_200, offset: 0, limit: 20 },
    hydration: "ok",
    artwork: "ok",
    offers: "ok",
    ...overrides,
  };
}

describe("listTokens", () => {
  it("maps a page and flattens its pagination", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { data: listPage() }));

    const page = await listTokens(http(fetchFn), { protocol: "counterparty" });

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens?protocol=counterparty",
    );
    expect(page).toEqual({
      protocol: "counterparty",
      listedOnly: false,
      source: "catalogue",
      total: 4_200,
      offset: 0,
      limit: 20,
      hydration: "ok",
      artwork: "ok",
      offers: "ok",
      results: [
        {
          protocol: "counterparty",
          protocolLabel: "Counterparty",
          id: "PEPECASH",
          canonicalId: "counterparty:PEPECASH",
          network: "mainnet",
          name: "PEPECASH",
          subtitle: "Rare Pepes",
          imageUrl: "https://example.com/pepecash.jpg",
          imageIsPlaceholder: false,
          thumbnailUrl: null,
          floorPriceSats: 5_000,
          offersCount: 3,
          listed: true,
          collection: { name: "Rare Pepes", slug: "rare-pepes" },
          apiUrl: "https://example.com/api/tokens/counterparty/PEPECASH",
          webUrl: "https://example.com/assets/PEPECASH",
        },
      ],
    });
  });

  it("a row addresses its own detail endpoint", async () => {
    // Same contract as a search hit: a tile nobody can open is useless.
    const fetchFn = makeRawFetch(rawResponse(200, { data: listPage() }));
    const page = await listTokens(http(fetchFn), { protocol: "counterparty" });
    const row = page!.results[0]!;
    expect(row.apiUrl).toBe(
      `https://example.com${tokenApiPath(row.protocol, row.id)}`,
    );
  });

  it("sends every param it was given", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        data: listPage({
          protocol: "ordinals",
          listed_only: true,
          source: "order_book",
          pagination: { total: 83, offset: 40, limit: 40 },
        }),
      }),
    );

    const page = await listTokens(http(fetchFn), {
      protocol: "ordinals",
      offset: 40,
      limit: 40,
      listedOnly: true,
    });

    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens?protocol=ordinals&offset=40&limit=40&listed_only=true",
    );
    expect(page?.source).toBe("order_book");
    expect(page?.offset).toBe(40);
  });

  it("omits listed_only when false, and offset 0 when explicit", async () => {
    // `offset=0` is sent because it was asked for — a caller re-reading the
    // first page should get the same URL as the server's own default page.
    const fetchFn = makeRawFetch(rawResponse(200, { data: listPage() }));
    await listTokens(http(fetchFn), {
      protocol: "counterparty",
      offset: 0,
      listedOnly: false,
    });
    expect(lastUrl(fetchFn)).toBe(
      "https://example.com/api/tokens?protocol=counterparty&offset=0",
    );
  });

  it("answers null when the network doesn't serve the protocol", async () => {
    // Kontor off signet. Deliberately not an empty page: a caller would page
    // through that forever with no way to tell "none" from "not here".
    const fetchFn = makeRawFetch(rawResponse(404, { error: "Token not found" }));
    await expect(
      listTokens(http(fetchFn), { protocol: "kontor-nft" }),
    ).resolves.toBeNull();
  });

  it("reports a degraded page rather than hiding it", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        data: listPage({ hydration: "error", offers: "error" }),
      }),
    );
    const page = await listTokens(http(fetchFn), { protocol: "counterparty" });
    expect(page?.hydration).toBe("error");
    expect(page?.offers).toBe("error");
  });

  it("keeps a half-illustrated page distinct from a failed one", async () => {
    // `artwork` is its own status because it is not a failure: the rows that
    // kept a placeholder do have art, the server just ran out of time resolving
    // it, and the next read is better illustrated. Naming and pricing are fine.
    const fetchFn = makeRawFetch(
      rawResponse(200, { data: listPage({ artwork: "partial" }) }),
    );
    const page = await listTokens(http(fetchFn), { protocol: "counterparty" });
    expect(page?.artwork).toBe("partial");
    expect(page?.hydration).toBe("ok");
    expect(page?.offers).toBe("ok");
  });

  it("defaults a page whose results and pagination are absent", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        data: { protocol: "ordinals", listed_only: false, source: "catalogue" },
      }),
    );
    const page = await listTokens(http(fetchFn), { protocol: "ordinals" });
    // Including a status a server predating the field never sends: absent is
    // "nothing to report", not "unknown".
    expect(page).toMatchObject({
      results: [],
      total: 0,
      offset: 0,
      limit: 0,
      hydration: "ok",
      artwork: "ok",
      offers: "ok",
    });
  });

  it("throws on a rejected protocol", async () => {
    // `zeld` / `kontor` are single tokens — the server answers 400 naming the
    // detail route, which is a caller error, not an empty list.
    const fetchFn = makeRawFetch(
      rawResponse(
        400,
        { error: "zeld is a single token, not a catalogue" },
        "Bad Request",
      ),
    );
    await expect(
      listTokens(http(fetchFn), {
        protocol: "zeld" as unknown as "counterparty",
      }),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
  });
});
