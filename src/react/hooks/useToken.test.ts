// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useToken, useTokenActivity, useTokenChart } from "./useToken.js";
import type {
  TokenActivityPage,
  TokenChart,
  TokenDetail,
  TokenRef,
} from "../../api/tokens.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const REF: TokenRef = { protocol: "counterparty", id: "RAREPEPE" };

function detail(overrides: Partial<TokenDetail> = {}): TokenDetail {
  return {
    protocol: "counterparty",
    protocolLabel: "Counterparty",
    id: "RAREPEPE",
    canonicalId: "counterparty:RAREPEPE",
    network: "mainnet",
    name: "RAREPEPE",
    subtitle: null,
    tagline: null,
    description: null,
    media: {
      kind: "image",
      imageUrl: "https://example.com/i.png",
      imageLargeUrl: "https://example.com/i.png",
      imageIsPlaceholder: false,
      thumbnailUrl: null,
      contentUrl: null,
      contentType: null,
      audioUrl: null,
      videoUrl: null,
      embedUrl: null,
      embedHeight: null,
    },
    stats: [],
    properties: [],
    attributes: [],
    market: null,
    offers: {
      count: 0,
      floorPriceSats: null,
      webUrl: "https://example.com/assets/RAREPEPE",
      atomicSwapsQuery: {},
    },
    links: [],
    collection: null,
    issuer: null,
    capabilities: {
      chart: true,
      activity: true,
      holders: false,
      attributes: false,
      transactions: false,
    },
    availableSections: ["chart", "activity"],
    chart: null,
    webUrl: "https://example.com/assets/RAREPEPE",
    generatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function chartFixture(range: string): TokenChart {
  return {
    range: range as TokenChart["range"],
    from: "2026-07-10T00:00:00.000Z",
    to: "2026-08-10T00:00:00.000Z",
    intervalSeconds: 14_400,
    intervalLabel: "4 hours",
    quoteAsset: "BTC",
    priceUnit: "sats",
    volumeUnit: "RAREPEPE",
    tradeCount: 1,
    points: [
      { time: "2026-07-10T00:00:00.000Z", price: 100, volume: 1, type: "trade" },
    ],
  };
}

function activityPage(
  offset: number,
  count: number,
  total: number,
): TokenActivityPage {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      time: `2026-08-0${(offset + i) % 9}T00:00:00.000Z`,
      eventType: "sale" as const,
      priceSats: 1000 + offset + i,
      quantity: "1",
      buyerAddress: null,
      sellerAddress: null,
      txid: null,
    })),
    total,
    offset,
    limit: count,
  };
}

beforeEach(() => {
  ctxRef.current = null;
});

// ─── useToken ────────────────────────────────────────────────────────────────

describe("useToken", () => {
  it("loads the token for a ref", async () => {
    const getToken = vi.fn(async () => detail());
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result } = renderHook(() => useToken(REF));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getToken).toHaveBeenCalledWith(REF);
    expect(result.current.token?.canonicalId).toBe("counterparty:RAREPEPE");
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays idle for a null ref and issues no request", async () => {
    const getToken = vi.fn(async () => detail());
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result } = renderHook(() => useToken(null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getToken).not.toHaveBeenCalled();
    expect(result.current.token).toBeNull();
  });

  it("does not refetch when the caller rebuilds an equal ref object", async () => {
    // A screen building `{ protocol, id }` inline in its render would otherwise
    // fetch on every render forever.
    const getToken = vi.fn(async () => detail());
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result, rerender } = renderHook(
      ({ p, i }: { p: string; i: string }) =>
        useToken({ protocol: p, id: i } as TokenRef),
      { initialProps: { p: "counterparty", i: "RAREPEPE" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ p: "counterparty", i: "RAREPEPE" });
    rerender({ p: "counterparty", i: "RAREPEPE" });
    expect(getToken).toHaveBeenCalledTimes(1);

    rerender({ p: "counterparty", i: "PEPECASH" });
    await waitFor(() => expect(getToken).toHaveBeenCalledTimes(2));
    expect(getToken).toHaveBeenLastCalledWith({
      protocol: "counterparty",
      id: "PEPECASH",
    });
  });

  it("reports notFound (not an error) when the network serves no such token", async () => {
    // Kontor asked of a mainnet host — a legitimate 404, mapped to null.
    const getToken = vi.fn(async () => null);
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result } = renderHook(() =>
      useToken({ protocol: "kontor", id: "KOR" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a read failure", async () => {
    const getToken = vi.fn(async () => {
      throw new Error("upstream down");
    });
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result } = renderHook(() => useToken(REF));

    await waitFor(() => expect(result.current.error).toBe("upstream down"));
    expect(result.current.loading).toBe(false);
  });

  it("refresh re-reads the token", async () => {
    const getToken = vi.fn(async () => detail());
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result } = renderHook(() => useToken(REF));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.refresh());
    await waitFor(() => expect(getToken).toHaveBeenCalledTimes(2));
  });

  it("a slow earlier read never overwrites a newer one", async () => {
    let resolveFirst: ((value: TokenDetail) => void) | undefined;
    const getToken = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<TokenDetail>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(async () => detail({ id: "PEPECASH" }));
    ctxRef.current = makeCtx({ client: { getToken } });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useToken({ protocol: "counterparty", id } as TokenRef),
      { initialProps: { id: "RAREPEPE" } },
    );

    rerender({ id: "PEPECASH" });
    await waitFor(() => expect(result.current.token?.id).toBe("PEPECASH"));

    // The first token finally lands — and must be dropped.
    await act(async () => {
      resolveFirst?.(detail({ id: "RAREPEPE" }));
    });
    expect(result.current.token?.id).toBe("PEPECASH");
  });
});

// ─── useTokenChart ───────────────────────────────────────────────────────────

describe("useTokenChart", () => {
  it("loads the default range and refetches when it changes", async () => {
    const getTokenChart = vi.fn(
      async (_ref: TokenRef, params: { range: string }) =>
        chartFixture(params.range),
    );
    ctxRef.current = makeCtx({ client: { getTokenChart } });

    const { result } = renderHook(() => useTokenChart(REF));

    await waitFor(() => expect(result.current.chart).not.toBeNull());
    expect(getTokenChart).toHaveBeenCalledWith(REF, { range: "1M" });

    act(() => result.current.setRange("1Y"));
    await waitFor(() => expect(result.current.chart?.range).toBe("1Y"));
    expect(result.current.range).toBe("1Y");
  });

  it("honours an explicit default range", async () => {
    const getTokenChart = vi.fn(async () => chartFixture("1W"));
    ctxRef.current = makeCtx({ client: { getTokenChart } });

    renderHook(() => useTokenChart(REF, { defaultRange: "1W" }));

    await waitFor(() =>
      expect(getTokenChart).toHaveBeenCalledWith(REF, { range: "1W" }),
    );
  });

  it("keeps the previous series on screen while the next range loads", async () => {
    let resolveSecond: ((value: TokenChart) => void) | undefined;
    const getTokenChart = vi
      .fn()
      .mockImplementationOnce(async () => chartFixture("1M"))
      .mockImplementationOnce(
        () => new Promise<TokenChart>((resolve) => (resolveSecond = resolve)),
      );
    ctxRef.current = makeCtx({ client: { getTokenChart } });

    const { result } = renderHook(() => useTokenChart(REF));
    await waitFor(() => expect(result.current.chart?.range).toBe("1M"));

    act(() => result.current.setRange("1Y"));
    await waitFor(() => expect(result.current.loading).toBe(true));
    // Still the old graph, not a blank one.
    expect(result.current.chart?.range).toBe("1M");

    await act(async () => {
      resolveSecond?.(chartFixture("1Y"));
    });
    expect(result.current.chart?.range).toBe("1Y");
  });

  it("reports a chartless token as a null series, not an error", async () => {
    const getTokenChart = vi.fn(async () => null);
    ctxRef.current = makeCtx({ client: { getTokenChart } });

    const { result } = renderHook(() =>
      useTokenChart({ protocol: "kontor-nft", id: "nft-7" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chart).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ─── useTokenActivity ────────────────────────────────────────────────────────

describe("useTokenActivity", () => {
  it("loads the first page", async () => {
    const getTokenActivity = vi.fn(async () => activityPage(0, 2, 5));
    ctxRef.current = makeCtx({ client: { getTokenActivity } });

    const { result } = renderHook(() => useTokenActivity(REF, { limit: 2 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getTokenActivity).toHaveBeenCalledWith(REF, { offset: 0, limit: 2 });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(5);
    expect(result.current.hasMore).toBe(true);
  });

  it("appends the next page and stops at the end", async () => {
    const getTokenActivity = vi.fn(
      async (_ref: TokenRef, params: { offset: number; limit: number }) =>
        activityPage(params.offset, params.offset === 0 ? 2 : 1, 3),
    );
    ctxRef.current = makeCtx({ client: { getTokenActivity } });

    const { result } = renderHook(() => useTokenActivity(REF, { limit: 2 }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(getTokenActivity).toHaveBeenLastCalledWith(REF, {
      offset: 2,
      limit: 2,
    });
    expect(result.current.hasMore).toBe(false);

    // At the end, loadMore is a no-op rather than a request for an empty page.
    act(() => result.current.loadMore());
    expect(getTokenActivity).toHaveBeenCalledTimes(2);
  });

  it("drops a page that lands after the token changed", async () => {
    let resolveMore: ((page: TokenActivityPage) => void) | undefined;
    const getTokenActivity = vi
      .fn()
      .mockImplementationOnce(async () => activityPage(0, 2, 9))
      .mockImplementationOnce(
        () =>
          new Promise<TokenActivityPage>((resolve) => (resolveMore = resolve)),
      )
      .mockImplementation(async () => activityPage(0, 1, 1));
    ctxRef.current = makeCtx({ client: { getTokenActivity } });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTokenActivity({ protocol: "counterparty", id } as TokenRef, {
          limit: 2,
        }),
      { initialProps: { id: "RAREPEPE" } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.loadMore());
    rerender({ id: "PEPECASH" });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    // The superseded page arrives — appending it would splice one token's sales
    // into another's list.
    await act(async () => {
      resolveMore?.(activityPage(2, 2, 9));
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(1);
  });

  it("surfaces a read failure", async () => {
    const getTokenActivity = vi.fn(async () => {
      throw new Error("activity down");
    });
    ctxRef.current = makeCtx({ client: { getTokenActivity } });

    const { result } = renderHook(() => useTokenActivity(REF));

    await waitFor(() => expect(result.current.error).toBe("activity down"));
  });
});
