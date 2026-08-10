// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useTokenSearch } from "./useTokenSearch.js";
import type {
  TokenSearchParams,
  TokenSearchResult,
  TokenSummary,
} from "../../api/tokens.js";

/**
 * A `searchTokens` stub typed with the arguments the hook passes, so the tests
 * can assert on `mock.calls` (a bare `vi.fn(async () => …)` infers a zero-arity
 * signature and makes every call tuple empty).
 */
function stubSearch(
  reply: (params: TokenSearchParams) => TokenSearchResult,
) {
  return vi.fn(
    async (params: TokenSearchParams, _options?: { signal?: AbortSignal }) =>
      reply(params),
  );
}

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

function summary(name: string): TokenSummary {
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
    match: { field: "name", kind: "prefix" },
  };
}

function searchResult(
  overrides: Partial<TokenSearchResult> = {},
): TokenSearchResult {
  return {
    query: "PEPE",
    results: [summary("PEPECASH")],
    truncated: false,
    sources: {
      counterparty: "ok",
      zeld: "ok",
      ordinals: "ok",
      kontor: "skipped",
      "kontor-nft": "skipped",
    },
    offers: "ok",
    ...overrides,
  };
}

beforeEach(() => {
  ctxRef.current = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTokenSearch", () => {
  it("issues no request for an empty query", async () => {
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(searchTokens).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("debounces: one request for a burst of keystrokes", async () => {
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());

    act(() => result.current.setQuery("P"));
    act(() => result.current.setQuery("PE"));
    act(() => result.current.setQuery("PEP"));
    act(() => result.current.setQuery("PEPE"));

    // Spinner from the first keystroke — results on screen belong to an older
    // query until this one lands.
    expect(result.current.loading).toBe(true);
    expect(searchTokens).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(searchTokens).toHaveBeenCalledTimes(1);
    expect(searchTokens.mock.calls[0]![0]).toMatchObject({ query: "PEPE" });
    expect(result.current.results).toHaveLength(1);
  });

  it("trims the query and passes the options through", async () => {
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() =>
      useTokenSearch({ limit: 50, protocols: ["ordinals"], listedOnly: true }),
    );

    act(() => result.current.setQuery("  abc  "));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(searchTokens.mock.calls[0]![0]).toEqual({
      query: "abc",
      limit: 50,
      protocols: ["ordinals"],
      listedOnly: true,
    });
  });

  it("aborts the superseded request", async () => {
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());

    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const firstSignal = searchTokens.mock.calls[0]![1]!.signal!;
    expect(firstSignal.aborted).toBe(false);

    act(() => result.current.setQuery("RARE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(firstSignal.aborted).toBe(true);
    expect(searchTokens).toHaveBeenCalledTimes(2);
  });

  it("clears results the moment the box is emptied", async () => {
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.results).toHaveLength(1);

    act(() => result.current.clear());
    // Not "after the next response" — an empty field must not show old hits.
    expect(result.current.results).toEqual([]);
    expect(result.current.query).toBe("");
    expect(result.current.loading).toBe(false);
  });

  it("skipped sources are not degradation", async () => {
    // Kontor off signet, or a protocol filter — deterministic, and cacheable
    // server-side. Reporting it as a failure would nag on every mainnet search.
    const searchTokens = stubSearch(() => searchResult());
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.degraded).toBe(false);
  });

  it("flags a timed-out source as degraded", async () => {
    const searchTokens = stubSearch(() =>
      searchResult({ sources: { counterparty: "ok", ordinals: "timeout" } }),
    );
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.degraded).toBe(true);
    expect(result.current.sources.ordinals).toBe("timeout");
  });

  it("flags a failed offer aggregate as degraded", async () => {
    // Every row comes back unlisted and unpriced, which reads exactly like a
    // page where nothing happens to be listed.
    const searchTokens = stubSearch(() => searchResult({ offers: "error" }));
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.degraded).toBe(true);
  });

  it("reports truncation", async () => {
    const searchTokens = stubSearch(() => searchResult({ truncated: true }));
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("A"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.truncated).toBe(true);
  });

  it("surfaces a failure and drops stale results", async () => {
    const searchTokens = stubSearch(() => {
      throw new Error("search down");
    });
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.error).toBe("search down"));
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("stringifies a rejection that is not an Error", async () => {
    const searchTokens = stubSearch(() => {
      throw "search exploded";
    });
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.error).toBe("search exploded"));
  });

  it("clear() empties the box and everything under it", async () => {
    const searchTokens = stubSearch(() =>
      searchResult({ truncated: true, offers: "error" }),
    );
    ctxRef.current = makeCtx({ client: { searchTokens } });

    const { result } = renderHook(() => useTokenSearch());
    act(() => result.current.setQuery("PEPE"));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(result.current.results).not.toHaveLength(0));

    act(() => result.current.clear());
    await waitFor(() => expect(result.current.query).toBe(""));
    expect(result.current.results).toEqual([]);
    expect(result.current.truncated).toBe(false);
    expect(result.current.degraded).toBe(false);
    expect(result.current.sources).toEqual({});
  });
});
