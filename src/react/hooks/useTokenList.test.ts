// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useTokenList } from "./useTokenList.js";
import type {
  TokenListPage,
  TokenListParams,
  TokenSummary,
} from "../../api/tokens.js";

/**
 * A `listTokens` stub typed with the arguments the hook passes, so the tests can
 * assert on `mock.calls` (a bare `vi.fn(async () => …)` infers a zero-arity
 * signature and makes every call tuple empty).
 */
function stubList(
  reply: (params: TokenListParams) => TokenListPage | null,
) {
  return vi.fn(
    async (params: TokenListParams, _options?: { signal?: AbortSignal }) =>
      reply(params),
  );
}

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function row(name: string): TokenSummary {
  return {
    protocol: "counterparty",
    protocolLabel: "Counterparty",
    id: name,
    canonicalId: `counterparty:${name}`,
    network: "mainnet",
    name,
    subtitle: null,
    imageUrl: "https://example.com/i.png",
    imageIsPlaceholder: true,
    thumbnailUrl: null,
    floorPriceSats: null,
    offersCount: 0,
    listed: false,
    collection: null,
    apiUrl: `https://example.com/api/tokens/counterparty/${name}`,
    webUrl: `https://example.com/assets/${name}`,
  };
}

/** A page of `count` rows named after their absolute position. */
function page(overrides: Partial<TokenListPage> = {}): TokenListPage {
  const offset = overrides.offset ?? 0;
  const limit = overrides.limit ?? 2;
  return {
    protocol: "counterparty",
    listedOnly: false,
    source: "catalogue",
    results: Array.from({ length: limit }, (_, i) => row(`ASSET${offset + i}`)),
    total: 6,
    offset,
    limit,
    hydration: "ok",
    artwork: "ok",
    offers: "ok",
    ...overrides,
  };
}

beforeEach(() => {
  ctxRef.current = null;
});

describe("useTokenList", () => {
  it("reads the first page on mount", async () => {
    const listTokens = stubList((params) => page({ offset: params.offset ?? 0 }));
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 2 }),
    );

    // Loading from the first frame: the read starts in an effect, so `false`
    // here would paint one frame of an empty grid.
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listTokens.mock.calls[0]![0]).toEqual({
      protocol: "counterparty",
      listedOnly: false,
      offset: 0,
      limit: 2,
    });
    expect(result.current.tokens.map((t) => t.name)).toEqual([
      "ASSET0",
      "ASSET1",
    ]);
    expect(result.current.total).toBe(6);
    expect(result.current.source).toBe("catalogue");
    expect(result.current.hasMore).toBe(true);
  });

  it("appends the next page from the loaded count", async () => {
    const listTokens = stubList((params) =>
      page({ offset: params.offset ?? 0 }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 2 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(listTokens.mock.calls[1]![0]).toMatchObject({ offset: 2 });
    expect(result.current.tokens.map((t) => t.name)).toEqual([
      "ASSET0",
      "ASSET1",
      "ASSET2",
      "ASSET3",
    ]);
    expect(result.current.hasMore).toBe(true);
  });

  it("two loadMore calls in one tick fetch one page", async () => {
    // What a grid's `onEndReached` actually does — without the synchronous
    // guard both would read offset 2 and splice the same rows in twice.
    const listTokens = stubList((params) =>
      page({ offset: params.offset ?? 0 }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 2 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));

    expect(listTokens).toHaveBeenCalledTimes(2);
    expect(result.current.tokens).toHaveLength(4);
  });

  it("stops paging at the end of the feed", async () => {
    const listTokens = stubList(() =>
      page({ total: 2, results: [row("A"), row("B")] }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 2 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);
    await act(async () => result.current.loadMore());
    expect(listTokens).toHaveBeenCalledTimes(1);
  });

  it("re-reads from offset 0 when the protocol changes", async () => {
    const listTokens = stubList((params) =>
      page({
        protocol: params.protocol,
        offset: params.offset ?? 0,
        results: [row(`${params.protocol}-${params.offset ?? 0}`)],
        limit: 1,
      }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const initialProps: { protocol: "counterparty" | "ordinals" } = {
      protocol: "counterparty",
    };
    const { result, rerender } = renderHook(
      (props: { protocol: "counterparty" | "ordinals" }) =>
        useTokenList({ protocol: props.protocol, limit: 1 }),
      { initialProps },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.tokens).toHaveLength(2));

    rerender({ protocol: "ordinals" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // One catalogue's rows must never be appended to another's.
    expect(result.current.tokens.map((t) => t.name)).toEqual(["ordinals-0"]);
    expect(listTokens.mock.calls.at(-1)![0]).toMatchObject({
      protocol: "ordinals",
      offset: 0,
    });
  });

  it("re-reads when the Listed filter flips", async () => {
    const listTokens = stubList((params) =>
      page({
        listedOnly: params.listedOnly ?? false,
        source: params.listedOnly ? "order_book" : "catalogue",
        limit: 1,
        total: 1,
      }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result, rerender } = renderHook(
      (props: { listedOnly: boolean }) =>
        useTokenList({ protocol: "counterparty", listedOnly: props.listedOnly }),
      { initialProps: { listedOnly: false } },
    );
    await waitFor(() => expect(result.current.source).toBe("catalogue"));

    rerender({ listedOnly: true });
    await waitFor(() => expect(result.current.source).toBe("order_book"));
    expect(listTokens.mock.calls.at(-1)![0]).toMatchObject({
      listedOnly: true,
      offset: 0,
    });
  });

  it("reports a protocol this network doesn't serve", async () => {
    // Kontor off signet: `notAvailable`, not an empty list a user would read
    // as "there are no NFTs".
    const listTokens = stubList(() => null);
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "kontor-nft" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notAvailable).toBe(true);
    expect(result.current.tokens).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("keeps a half-illustrated page out of the degraded flag", async () => {
    // `artwork: "partial"` means the server ran out of time resolving pictures,
    // not that anything failed — a grid that says "something went wrong" because
    // the next read will be prettier is a worse grid. It is surfaced as its own
    // signal so a caller can offer a refresh instead.
    const listTokens = stubList(() => page({ artwork: "partial" }));
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.artworkPartial).toBe(true);
    expect(result.current.artwork).toBe("partial");
    expect(result.current.degraded).toBe(false);
  });

  it("flags a page that looks healthy but isn't", async () => {
    const listTokens = stubList(() =>
      page({ hydration: "error", offers: "error" }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.degraded).toBe(true);
    expect(result.current.hydration).toBe("error");
    expect(result.current.offers).toBe("error");
  });

  it("surfaces a failed read and recovers on refresh", async () => {
    let fail = true;
    const listTokens = vi.fn(async () => {
      if (fail) throw new Error("upstream down");
      return page({ total: 1, limit: 1 });
    });
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 1 }),
    );
    await waitFor(() => expect(result.current.error).toBe("upstream down"));
    expect(result.current.loading).toBe(false);

    fail = false;
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.tokens).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it("does not report an aborted read as a failure", async () => {
    // Unmounting mid-read rejects with AbortError; an error banner would then
    // belong to a screen nobody is looking at.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const listTokens = vi.fn(async () => {
      throw abort;
    });
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty" }),
    );
    await act(async () => {});

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("keeps loadMore stable across appended rows", async () => {
    // A grid's `onEndReached` should not be a new function per row.
    const listTokens = stubList((params) =>
      page({ offset: params.offset ?? 0 }),
    );
    ctxRef.current = makeCtx({ client: { listTokens } });

    const { result } = renderHook(() =>
      useTokenList({ protocol: "counterparty", limit: 2 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.loadMore;

    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.tokens).toHaveLength(4));

    expect(result.current.loadMore).toBe(first);
  });
});
