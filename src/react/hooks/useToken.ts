import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  TokenActivityItem,
  TokenChart,
  TokenChartRange,
  TokenDetail,
  TokenRef,
} from "../../api/tokens.js";

/**
 * Reads of one token over `/api/tokens/*`.
 *
 * The API answers with the same shape for all five asset types, so these hooks
 * are protocol-blind: a screen mounts them with a {@link TokenRef} and renders
 * whatever comes back, using `capabilities` / `availableSections` to decide
 * which sections exist rather than branching on the protocol itself.
 */

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A stable string for a ref, so the effects below depend on the token's
 * *identity* rather than on object identity — a caller building
 * `{ protocol, id }` inline in its render would otherwise refetch every render.
 */
function refKey(ref: TokenRef | null): string {
  return ref ? `${ref.protocol}:${ref.id}` : "";
}

/**
 * True for the rejection an aborted request produces.
 *
 * Every read below is aborted when it is superseded or the component unmounts,
 * and that rejects the promise — reporting it as a read failure would put an
 * error banner on a screen the user has already left.
 *
 * `AbortError` only: a `TimeoutError` (what `AbortSignal.timeout` rejects with,
 * should a caller ever hand one down) is a read that FAILED, not one nobody is
 * waiting for. Swallowing it would leave `loading` true forever, with no error
 * to explain the spinner.
 */
function isAbort(err: unknown): boolean {
  // Duck-typed on `name`, not `instanceof Error`: `fetch` rejects an aborted
  // request with a DOMException, which does not extend Error on every runtime
  // this SDK ships to.
  return (err as { name?: unknown } | null)?.name === "AbortError";
}

export interface UseTokenResult {
  /** The token, `null` before the first read resolves or when there is none. */
  token: TokenDetail | null;
  /** True while a read is in flight. */
  loading: boolean;
  /**
   * True once a read came back 404 — the token does not exist, or this network
   * does not serve it (Kontor is signet-only). Distinct from {@link error},
   * which means the read itself failed.
   */
  notFound: boolean;
  /** Last read error, or `null`. */
  error: string | null;
  /** Re-read the token from the server. */
  refresh: () => void;
}

/**
 * One token's detail payload. Idle (and empty) while `ref` is `null`, so a
 * screen can mount this before its route params resolve.
 */
export function useToken(ref: TokenRef | null): UseTokenResult {
  const { client } = useHorizonMarket();
  const key = refKey(ref);
  // The effect keys off `key` (a value), not the object — but it needs the
  // object itself to make the call, so carry it through a ref.
  const refRef = useRef(ref);
  refRef.current = ref;

  const [token, setToken] = useState<TokenDetail | null>(null);
  // Seeded from the ref rather than `false`: the first read starts in an effect,
  // which runs AFTER the first paint, so starting at `false` renders one frame
  // that is neither loading nor loaded — a blank flash under the header.
  const [loading, setLoading] = useState(ref !== null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic guard: a slower earlier read must never overwrite a newer one
  // (switching tokens, or a refresh racing the initial load).
  const seqRef = useRef(0);
  const keyRef = useRef(key);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const current = refRef.current;
    // A DIFFERENT token: drop the one on screen rather than rendering its
    // payload under the new one's route while the read is in flight. A
    // `refresh` keys the same token, so it deliberately keeps what is shown.
    const switched = keyRef.current !== key;
    keyRef.current = key;
    if (switched) {
      setToken(null);
      setNotFound(false);
    }

    if (!current) {
      setToken(null);
      setLoading(false);
      setNotFound(false);
      setError(null);
      return;
    }

    // Abort the superseded read rather than letting it finish for a token the
    // user has already left. `seq` alone does not cover unmount (nothing bumps
    // it there), so the cleanup below also aborts.
    const controller = new AbortController();

    setLoading(true);
    setError(null);
    setNotFound(false);
    client
      .getToken(current, { signal: controller.signal })
      .then((next) => {
        if (seq !== seqRef.current) return;
        setToken(next);
        setNotFound(next === null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || seq !== seqRef.current) return;
        setError(message(err));
        setLoading(false);
      });

    return () => controller.abort();
  }, [client, key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { token, loading, notFound, error, refresh };
}

export interface UseTokenChartOptions {
  /** Window to start on. Defaults to the API's own default (`1M`). */
  defaultRange?: TokenChartRange;
}

export interface UseTokenChartResult {
  /**
   * The current series, or `null` before the first read / when the token has no
   * chart. The previous series is kept on screen while the next RANGE loads, so
   * changing range does not blank the graph — but a change of *token* clears it,
   * since one token's prices under another's name would simply be wrong.
   */
  chart: TokenChart | null;
  loading: boolean;
  error: string | null;
  range: TokenChartRange;
  setRange: (range: TokenChartRange) => void;
}

/**
 * A token's price series for a preset range. Only mount this when the detail
 * payload says `capabilities.chart` — a one-of-a-kind token has no series and
 * the endpoint answers 404 (surfaced here as `chart: null`, not an error).
 */
export function useTokenChart(
  ref: TokenRef | null,
  options?: UseTokenChartOptions,
): UseTokenChartResult {
  const { client } = useHorizonMarket();
  const key = refKey(ref);
  const refRef = useRef(ref);
  refRef.current = ref;

  const [range, setRange] = useState<TokenChartRange>(
    options?.defaultRange ?? "1M",
  );
  const [chart, setChart] = useState<TokenChart | null>(null);
  // Seeded from the ref for the same reason as `useToken` — see there.
  const [loading, setLoading] = useState(ref !== null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const keyRef = useRef(key);

  useEffect(() => {
    const seq = ++seqRef.current;
    const current = refRef.current;
    // Keeping the previous series is only right across a range change. On a
    // token change it would draw one token's prices under another's name, so
    // clear it and let the loading state show.
    const switched = keyRef.current !== key;
    keyRef.current = key;
    if (switched) setChart(null);

    if (!current) {
      setChart(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError(null);
    client
      .getTokenChart(current, { range }, { signal: controller.signal })
      .then((next) => {
        if (seq !== seqRef.current) return;
        setChart(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || seq !== seqRef.current) return;
        setError(message(err));
        setLoading(false);
      });

    return () => controller.abort();
  }, [client, key, range]);

  return { chart, loading, error, range, setRange };
}

export interface UseTokenActivityOptions {
  /** Page size. Defaults to 20. */
  limit?: number;
}

export interface UseTokenActivityResult {
  /** Sales loaded so far, newest first — appended page by page. */
  items: TokenActivityItem[];
  /** Total sales the server reports, across all pages. */
  total: number;
  /** True while the FIRST page is in flight. */
  loading: boolean;
  /** True while a {@link loadMore} page is in flight. */
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  /** Append the next page. No-op while a read is in flight or at the end. */
  loadMore: () => void;
  /** Drop everything and re-read the first page. */
  refresh: () => void;
}

/** A token's completed sales, paged. */
export function useTokenActivity(
  ref: TokenRef | null,
  options?: UseTokenActivityOptions,
): UseTokenActivityResult {
  const { client } = useHorizonMarket();
  const key = refKey(ref);
  const refRef = useRef(ref);
  refRef.current = ref;
  const limit = options?.limit ?? 20;

  const [items, setItems] = useState<TokenActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  // Seeded from the ref for the same reason as `useToken` — see there.
  const [loading, setLoading] = useState(ref !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const [nonce, setNonce] = useState(0);

  // Read through a ref inside `loadMore` so the callback stays stable — a list's
  // `onEndReached` should not be a new function on every appended row.
  const stateRef = useRef({ items, total, busy: false });
  stateRef.current = { items, total, busy: loading || loadingMore };
  // `busy` above only turns true on the NEXT render, so two `loadMore` calls in
  // one tick — which `onEndReached` does fire — would both pass the guard and
  // both fetch the same offset, splicing the page in twice. This flips
  // synchronously.
  const inFlightRef = useRef(false);
  // The in-flight `loadMore` request, so the reset effect can abort it: its
  // controller is created inside the callback and would otherwise outlive the
  // token it was fetched for.
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const seq = ++seqRef.current;
    const current = refRef.current;

    setItems([]);
    setTotal(0);
    setError(null);
    // A `loadMore` page still in flight is now for the previous token (the
    // sequence bump above discards it), so it must not keep the guard closed —
    // nor leave the spinner up. `loadingMore` in particular feeds `busy`, so a
    // stale `true` would make `loadMore` a permanent no-op for the new token.
    inFlightRef.current = false;
    setLoadingMore(false);
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;

    if (!current) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    client
      .getTokenActivity(current, { offset: 0, limit }, { signal: controller.signal })
      .then((page) => {
        if (seq !== seqRef.current) return;
        setItems(page.items);
        setTotal(page.total);
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
  }, [client, key, limit, nonce]);

  const loadMore = useCallback(() => {
    const { items: loaded, total: known, busy } = stateRef.current;
    const current = refRef.current;
    if (busy || inFlightRef.current || !current || loaded.length >= known)
      return;

    const seq = seqRef.current;
    const controller = new AbortController();
    inFlightRef.current = true;
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    client
      .getTokenActivity(
        current,
        { offset: loaded.length, limit },
        { signal: controller.signal },
      )
      .then((page) => {
        // A token switch (or a refresh) between request and response bumps the
        // sequence; appending that page would splice one token's sales into
        // another's list. The effect that bumped it has already cleared the
        // guard and the spinner, so this branch only has to drop the page.
        if (seq !== seqRef.current) return;
        inFlightRef.current = false;
        loadMoreAbortRef.current = null;
        setItems((prev) => [...prev, ...page.items]);
        setTotal(page.total);
        setLoadingMore(false);
      })
      .catch((err: unknown) => {
        if (isAbort(err) || seq !== seqRef.current) return;
        inFlightRef.current = false;
        loadMoreAbortRef.current = null;
        setError(message(err));
        setLoadingMore(false);
      });
    // Deliberately not keyed on the token: everything it reads comes through a
    // ref, and the sequence guard above discards a page that lands after a
    // switch — so this callback stays stable for a list's `onEndReached`.
  }, [client, limit]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const hasMore = items.length < total;

  return useMemo(
    () => ({
      items,
      total,
      loading,
      loadingMore,
      error,
      hasMore,
      loadMore,
      refresh,
    }),
    [items, total, loading, loadingMore, error, hasMore, loadMore, refresh],
  );
}
