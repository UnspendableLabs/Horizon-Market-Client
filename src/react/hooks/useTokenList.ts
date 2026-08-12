import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  BrowsableTokenProtocol,
  TokenArtworkStatus,
  TokenHydrationStatus,
  TokenListSource,
  TokenOfferAggregateStatus,
  TokenSummary,
} from "../../api/tokens.js";

/**
 * A paged browse feed over `GET /api/tokens` — one protocol's catalogue, in the
 * row shape {@link useTokenSearch} already returns.
 *
 * The feed's identity is `protocol` + `listedOnly`: changing either is a
 * different list, so the hook drops what it has and re-reads from offset 0
 * rather than appending one catalogue's rows to another's.
 */

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True for the rejection an aborted request produces — same reasoning as
 * `useToken`: every read here is aborted when superseded or unmounted, and
 * reporting that as a failure would put an error banner on a list the user has
 * already left. `AbortError` only; a `TimeoutError` is a read that FAILED.
 */
function isAbort(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === "AbortError";
}

export interface UseTokenListOptions {
  /** Which catalogue to page. ZELD and KOR are single tokens, so not browsable. */
  protocol: BrowsableTokenProtocol;
  /** Only tokens with at least one open offer. Defaults to false. */
  listedOnly?: boolean;
  /** Page size. Defaults to 20 — a grid page, and the server's own default. */
  limit?: number;
}

export interface UseTokenListResult {
  /**
   * Rows loaded so far, appended page by page and de-duplicated by
   * `canonicalId` — see {@link UseTokenListResult.pagedCount} for why a live
   * catalogue hands the same row out twice.
   */
  tokens: TokenSummary[];
  /**
   * How many rows the server has handed over, which is where the next page is
   * read from. It runs ahead of `tokens.length` once a feed has served a
   * duplicate: paging is by offset over a list that moves, so an item added
   * between two reads shifts everything after it — `recent_window` is ordered
   * newest first, so that is one shift per new inscription. The next offset is
   * a position in the *server's* list, so it counts what was sent rather than
   * what survived de-duplication; charging the duplicates to it would re-read
   * them forever.
   */
  pagedCount: number;
  /** How many rows exist in {@link source} — NOT in the protocol as a whole. */
  total: number;
  /**
   * Where this feed is paged from, `null` before the first page lands. Worth
   * surfacing: `recent_window` is a bounded window of recent items, so its end
   * is the edge of what is browsable rather than the end of the protocol.
   */
  source: TokenListSource | null;
  /** True while the FIRST page is in flight. */
  loading: boolean;
  /** True while a {@link loadMore} page is in flight. */
  loadingMore: boolean;
  error: string | null;
  /**
   * True once a read came back 404 — this network doesn't serve the protocol
   * (Kontor NFTs off signet). Distinct from {@link error}, which means the read
   * itself failed, and from an empty page, which is a real answer.
   */
  notAvailable: boolean;
  /**
   * True when the rows on screen say less than the server can normally say: the
   * offer aggregate failed (every row reads unlisted and unpriced) or the rows
   * could not be named by their own protocol. Either one produces a page that
   * looks healthy, which is exactly why it is reported — this is the flag to put
   * a notice behind.
   *
   * {@link artworkPartial} is deliberately NOT part of it: missing pictures are
   * not a failure, and a grid that says "something went wrong" because the next
   * read will be prettier is a worse grid.
   */
  degraded: boolean;
  /** Whether the last page's rows carry their protocol's names. */
  hydration: TokenHydrationStatus;
  /** Whether the last page's rows carry every picture that exists for them. */
  artwork: TokenArtworkStatus;
  /**
   * True when the server's artwork pass ran out of time on the last page, so
   * some rows are drawn as placeholders that do have art. A reason to offer
   * {@link refresh} (the resolutions that missed the deadline finish into the
   * server's cache, so the next read is better illustrated) — never a reason to
   * show an error.
   */
  artworkPartial: boolean;
  /** Outcome of the offer aggregate that priced the last page. */
  offers: TokenOfferAggregateStatus;
  hasMore: boolean;
  /** Append the next page. No-op while a read is in flight or at the end. */
  loadMore: () => void;
  /** Drop everything and re-read the first page. */
  refresh: () => void;
}

export function useTokenList(options: UseTokenListOptions): UseTokenListResult {
  const { client } = useHorizonMarket();
  const { protocol } = options;
  const listedOnly = options.listedOnly ?? false;
  const limit = options.limit ?? 20;

  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [pagedCount, setPagedCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState<TokenListSource | null>(null);
  // Starts true: the first read begins in an effect, which runs after the first
  // paint, so starting at `false` renders one frame that is neither loading nor
  // loaded — an empty grid flashing "nothing here" under the tabs.
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [hydration, setHydration] = useState<TokenHydrationStatus>("ok");
  const [artwork, setArtwork] = useState<TokenArtworkStatus>("ok");
  const [offers, setOffers] = useState<TokenOfferAggregateStatus>("ok");

  // Monotonic guard: a slower earlier read must never overwrite a newer one
  // (switching protocol or the Listed toggle, or a refresh racing the load).
  const seqRef = useRef(0);
  const [nonce, setNonce] = useState(0);

  // Read through a ref inside `loadMore` so the callback stays stable — a grid's
  // `onEndReached` should not be a new function on every appended row.
  const stateRef = useRef({ paged: pagedCount, total, busy: false });
  stateRef.current = { paged: pagedCount, total, busy: loading || loadingMore };
  // `busy` above only turns true on the NEXT render, so two `loadMore` calls in
  // one tick — which `onEndReached` does fire — would both pass the guard and
  // both fetch the same offset, splicing the page in twice. This flips
  // synchronously.
  const inFlightRef = useRef(false);
  // The in-flight `loadMore` request, so the reset effect can abort it: its
  // controller is created inside the callback and would otherwise outlive the
  // feed it was fetched for.
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const seq = ++seqRef.current;

    setTokens([]);
    setPagedCount(0);
    setTotal(0);
    setSource(null);
    setError(null);
    setNotAvailable(false);
    setHydration("ok");
    setArtwork("ok");
    setOffers("ok");
    // A `loadMore` page still in flight belongs to the previous feed (the
    // sequence bump above discards it), so it must not keep the guard closed —
    // nor leave the spinner up. `loadingMore` feeds `busy`, so a stale `true`
    // would make `loadMore` a permanent no-op for the new feed.
    inFlightRef.current = false;
    setLoadingMore(false);
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;

    const controller = new AbortController();

    setLoading(true);
    client
      .listTokens(
        { protocol, listedOnly, offset: 0, limit },
        { signal: controller.signal },
      )
      .then((page) => {
        if (seq !== seqRef.current) return;
        if (!page) {
          setNotAvailable(true);
          setLoading(false);
          return;
        }
        setTokens(page.results);
        setPagedCount(page.results.length);
        // Same clamp as `loadMore`: a first page that came back empty under a
        // non-zero total is an upstream contradicting itself, and taking its
        // word for it would leave `hasMore` true over an empty grid — which a
        // `onEndReached` reads as "fetch offset 0 again".
        setTotal(page.results.length === 0 ? 0 : page.total);
        setSource(page.source);
        setHydration(page.hydration);
        setArtwork(page.artwork);
        setOffers(page.offers);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || seq !== seqRef.current) return;
        setError(message(err));
        setLoading(false);
      });

    return () => {
      controller.abort();
      // Unmount: nothing bumps the sequence, so abort the paging read too.
      loadMoreAbortRef.current?.abort();
    };
  }, [client, protocol, listedOnly, limit, nonce]);

  const loadMore = useCallback(() => {
    const { paged, total: known, busy } = stateRef.current;
    if (busy || inFlightRef.current || paged >= known) return;

    const seq = seqRef.current;
    const controller = new AbortController();
    inFlightRef.current = true;
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    client
      .listTokens(
        { protocol, listedOnly, offset: paged, limit },
        { signal: controller.signal },
      )
      .then((page) => {
        // A feed switch (or a refresh) between request and response bumps the
        // sequence; appending that page would splice one catalogue's rows into
        // another's. The effect that bumped it has already cleared the guard and
        // the spinner, so this branch only has to drop the page.
        if (seq !== seqRef.current) return;
        inFlightRef.current = false;
        loadMoreAbortRef.current = null;
        if (page) {
          setTokens((prev) => {
            // Offset paging over a list that moves: an item added between two
            // reads shifts everything after it, so the tail of the page on
            // screen comes back at the head of the next one. Appending it
            // verbatim duplicates a tile and a React key.
            const seen = new Set(prev.map((token) => token.canonicalId));
            return [
              ...prev,
              ...page.results.filter((token) => !seen.has(token.canonicalId)),
            ];
          });
          // By what the server SENT, not by what survived the filter above —
          // see `pagedCount`.
          setPagedCount(paged + page.results.length);
          // An empty page under a non-zero total is the end of what the upstream
          // can actually serve. Trusting `total` there would leave `hasMore`
          // true against an offset that answers nothing, and a grid's
          // `onEndReached` would re-read it at every scroll.
          setTotal(page.results.length === 0 ? paged : page.total);
          // A page that landed clears the failure of the one before it: the
          // effect's reset only runs on a feed change, so a retried `loadMore`
          // would otherwise succeed under a stale error.
          setError(null);
          setHydration(page.hydration);
          // Both statuses describe the page that just landed, not the rows
          // already on screen — a later page is what a "load more" spinner and a
          // notice are attached to.
          setArtwork(page.artwork);
          setOffers(page.offers);
        } else {
          // A protocol that stopped being served mid-feed: keep what is on
          // screen (it was real) and stop paging. `total` is what `hasMore`
          // reads, so leaving it alone would have `onEndReached` re-read the
          // same 404 offset at every scroll rather than end the list.
          setNotAvailable(true);
          setTotal(paged);
        }
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || seq !== seqRef.current) return;
        inFlightRef.current = false;
        loadMoreAbortRef.current = null;
        setError(message(err));
        setLoadingMore(false);
      });
    // Deliberately not keyed on the loaded rows: everything the callback reads
    // comes through a ref, and the sequence guard discards a page that lands
    // after a switch — so it stays stable for a grid's `onEndReached`.
  }, [client, protocol, listedOnly, limit]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Against what was PAGED, not what is on screen: a feed that served a
  // duplicate has fewer rows than it has read, and measuring the end of the
  // list by the shorter of the two would page one offset past it forever.
  const hasMore = pagedCount < total;
  const degraded = hydration !== "ok" || offers !== "ok";
  const artworkPartial = artwork !== "ok";

  return useMemo(
    () => ({
      tokens,
      pagedCount,
      total,
      source,
      loading,
      loadingMore,
      error,
      notAvailable,
      degraded,
      hydration,
      artwork,
      artworkPartial,
      offers,
      hasMore,
      loadMore,
      refresh,
    }),
    [
      tokens,
      pagedCount,
      total,
      source,
      loading,
      loadingMore,
      error,
      notAvailable,
      degraded,
      hydration,
      artwork,
      artworkPartial,
      offers,
      hasMore,
      loadMore,
      refresh,
    ],
  );
}
