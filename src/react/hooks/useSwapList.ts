import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket, type Addresses } from "../context.js";
import type {
  AtomicSwap,
  SwapFacets,
  SwapFacetsParams,
} from "../../types/index.js";
import {
  DEFAULT_LIMIT,
  MY_SWAPS_MERGE_FETCH_LIMIT,
  OPTIMISTIC_PENDING_MAX_MS,
  PENDING_ORDERS_FETCH_LIMIT,
  PENDING_ORDERS_POLL_MS,
  SORT_MAP,
} from "../internal/swapListConstants.js";
import type {
  SortOption,
  SwapListingType,
} from "../internal/swapListConstants.js";
import {
  checkIsMySwap,
  clampPage,
  getSellerAddresses,
  mergeSwapsById,
  paginateSwaps,
  sortSwaps,
} from "../internal/swapListHelpers.js";

// The swap-list sort presets, the listing-type alias, and the sort key/direction
// types now live in the WASM-free `swapListConstants` module (also published at
// the `./swaps` subpath). Re-exported here so existing consumers importing them
// from the React entry (e.g. `SORT_OPTIONS`, `SortOption`) keep working unchanged.
export {
  SORT_OPTIONS,
  SORT_OPTION_LABELS,
} from "../internal/swapListConstants.js";
export type {
  SortOption,
  SwapListOrder,
  SwapListOrderBy,
  SwapListingType,
} from "../internal/swapListConstants.js";

export interface UseSwapListOptions {
  defaultListingType?: SwapListingType | null;
  defaultSortOption?: SortOption;
  defaultShowMySwaps?: boolean;
  /**
   * Start on the "Sold" feed (completed sales). Independent of
   * {@link defaultShowMySwaps}: on its own it shows the whole marketplace's
   * sales; combined with "My swaps" it shows only the wallet's own sales.
   */
  defaultShowSold?: boolean;
  limit?: number;
  /**
   * Also fetch the connected wallet's in-progress orders (pending sell listings
   * still settling on-chain and pending purchases whose buy tx is unconfirmed)
   * via the API's `pending_address` and expose them as
   * {@link UseSwapListResult.pendingOrders}, so the UI can surface them at the
   * top of the buy list. Off by default; the {@link SwapList} components enable
   * it. While any remain pending the set re-polls on its own (every
   * {@link PENDING_ORDERS_POLL_MS}) so an item drops out once its tx confirms.
   */
  includePendingOrders?: boolean;
  /** Initial minimum listing price filter, in sats. Null (default) = no lower bound. */
  defaultPriceMin?: number | null;
  /** Initial maximum listing price filter, in sats. Null (default) = no upper bound. */
  defaultPriceMax?: number | null;
  /** Initial collection-slug filter. Null (default) = all collections. */
  defaultCollection?: string | null;
  /**
   * Also fetch reactive facet counts (type / price bucket / collection) for the
   * current filter set via the client's `getSwapFacets`, and expose them as
   * {@link UseSwapListResult.facets} / {@link UseSwapListResult.facetsLoading} —
   * so a faceted filter sidebar can show live, filter-aware counts. Off by
   * default; one request runs per filter change (never one per option), guarded
   * against stale responses, and a failed facets fetch never surfaces the main
   * {@link UseSwapListResult.error} banner.
   */
  includeFacets?: boolean;
  /**
   * Fired from {@link UseSwapListResult.onItemAction} when acting on a swap
   * while logged out, right before the login modal opens. Observation only —
   * useful for analytics (e.g. "buy attempted, login required").
   */
  onLoginRequired?: (swap: AtomicSwap) => void;
  /**
   * Fired when the buy-confirmation modal opens for `swap` — either
   * immediately (already logged in) or after a successful login. Observation
   * only: the built-in confirmation modal still drives the UX unchanged.
   */
  onBuyStarted?: (swap: AtomicSwap) => void;
  /**
   * Fired when the delist-confirmation modal opens for the viewer's own
   * `swap` — either immediately or after a successful login. Observation
   * only, mirrors {@link UseSwapListOptions.onBuyStarted}.
   */
  onDelistStarted?: (swap: AtomicSwap) => void;
}

export interface UseSwapListResult {
  swaps: AtomicSwap[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  /** Epoch ms when the list was last (re-)fetched, or null before the first fetch. */
  lastFetchedAt: number | null;
  listingType: SwapListingType | null;
  setListingType: (t: SwapListingType | null) => void;
  sortOption: SortOption;
  setSortOption: (o: SortOption) => void;
  showMySwaps: boolean;
  setShowMySwaps: (v: boolean) => void;
  canShowMySwaps: boolean;
  /**
   * Show completed sales (filled swaps) instead of open listings, newest first.
   * Independent of {@link showMySwaps}: on its own it shows the whole
   * marketplace's sales; combined with "My swaps" it narrows to the connected
   * wallet's own sales. Always available (a public feed), so `canShowSold` is
   * always `true`, even logged out.
   */
  showSold: boolean;
  setShowSold: (v: boolean) => void;
  canShowSold: boolean;
  /** Active minimum listing-price filter in sats, or null for no lower bound. */
  priceMin: number | null;
  /** Active maximum listing-price filter in sats, or null for no upper bound. */
  priceMax: number | null;
  /**
   * Set the price-range filter (both bounds at once, in sats; pass null for an
   * open bound) and reset to the first page. Pair with the price buckets from
   * {@link UseSwapListResult.facets} (apply a bucket's `minSats`/`maxSats`).
   */
  setPriceRange: (min: number | null, max: number | null) => void;
  /** Active collection-slug filter, or null for all collections. */
  collection: string | null;
  /** Set the collection-slug filter (null clears it) and reset to the first page. */
  setCollection: (slug: string | null) => void;
  /**
   * Reactive facet counts (type / price bucket / collection) for the current
   * filter set, or null before the first load / when
   * {@link UseSwapListOptions.includeFacets} is off. Each dimension is counted
   * excluding its own active selection, so sibling options keep clickable counts.
   */
  facets: SwapFacets | null;
  /** True while a facets request is in flight (the last-known counts stay visible). */
  facetsLoading: boolean;
  /**
   * True when the Kontor filter is selected but Kontor is not enabled
   * (no `kontorNetwork="signet"` on the provider). Kontor is signet-only, so
   * the list is empty and the UI should show a "signet only" notice instead.
   */
  kontorUnavailable: boolean;
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  refetch: () => void;
  /**
   * Optimistically drop a swap from the list by id. Used after a successful buy
   * or delist: the on-chain fill has broadcast but the indexer hasn't marked the
   * swap `filled`/`delisted` yet, so a plain `refetch()` would re-fetch the same
   * item. The id is remembered for the session and filtered out of any later
   * fetch result too, so a lagging indexer can't make it reappear.
   */
  removeSwap: (swapId: string) => void;
  /**
   * Optimistically surface a just-made Kontor buy in {@link pendingOrders} right
   * away, independent of the server's `pending_address` decoration (which may lag
   * or, if the record POST failed, never mark it). Call from a buy-success handler
   * with the bought swap and its broadcast txid; the row is reconciled away once
   * the purchase settles (or after a safety timeout), at which point balances
   * force-refresh so the KOR appears.
   */
  trackPendingBuy: (swap: AtomicSwap, txid: string | null) => void;
  isItemMySwap: (swap: AtomicSwap) => boolean;
  /**
   * The connected wallet's in-progress orders, newest first — its pending sell
   * listings (still settling on-chain) and pending purchases (buy tx broadcast
   * but unconfirmed), each carrying `pendingRole` / `pendingTxid`. Empty unless
   * {@link UseSwapListOptions.includePendingOrders} is set and a wallet is
   * connected. Once an order's tx confirms it drops from here; a resolved listing
   * then appears in the main `swaps` feed and a resolved purchase leaves it.
   */
  pendingOrders: AtomicSwap[];
  pendingSwap: AtomicSwap | null;
  loginModalOpen: boolean;
  confirmationModalOpen: boolean;
  confirmationMode: "buy" | "sell";
  onItemAction: (swap: AtomicSwap) => void;
  closeLoginModal: () => void;
  closeConfirmationModal: () => void;
  handleLoginSuccess: (addresses: Addresses) => void;
}

export function useSwapList(options: UseSwapListOptions = {}): UseSwapListResult {
  const { client, addresses, kontorNetwork, refreshBalances } =
    useHorizonMarket();
  const {
    defaultListingType = null,
    defaultSortOption = "latest",
    defaultShowMySwaps = false,
    defaultShowSold = false,
    defaultPriceMin = null,
    defaultPriceMax = null,
    defaultCollection = null,
    limit = DEFAULT_LIMIT,
    includePendingOrders = false,
    includeFacets = false,
    onLoginRequired,
    onBuyStarted,
    onDelistStarted,
  } = options;

  // Latest analytics observers without forcing onItemAction/handleLoginSuccess
  // to re-create per render.
  const analyticsRef = useRef({ onLoginRequired, onBuyStarted, onDelistStarted });
  analyticsRef.current = { onLoginRequired, onBuyStarted, onDelistStarted };

  const [listingType, setListingTypeState] = useState<SwapListingType | null>(
    defaultListingType,
  );
  const [sortOption, setSortOptionState] = useState<SortOption>(
    defaultSortOption,
  );
  const [showMySwaps, setShowMySwapsState] = useState(defaultShowMySwaps);
  const [showSold, setShowSoldState] = useState(defaultShowSold);
  const [priceMin, setPriceMinState] = useState<number | null>(defaultPriceMin);
  const [priceMax, setPriceMaxState] = useState<number | null>(defaultPriceMax);
  const [collection, setCollectionState] = useState<string | null>(
    defaultCollection,
  );
  const [page, setPageState] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [swaps, setSwaps] = useState<AtomicSwap[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // When the current list was last (re-)fetched, for an "Updated …" label.
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // Reactive facet counts for the current filter set (populated only when
  // `includeFacets` is on). `facetsFetchSeqRef` guards against stale responses.
  const [facets, setFacets] = useState<SwapFacets | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const facetsFetchSeqRef = useRef(0);

  // The connected wallet's in-progress orders (pending listings + pending
  // purchases), fetched separately from the main feed via `pending_address`.
  // `pendingRefreshKey` drives the while-pending poll (below) that lets the
  // spinner resolve without a manual Refresh.
  const [pendingOrders, setPendingOrders] = useState<AtomicSwap[]>([]);
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
  const pendingFetchSeqRef = useRef(0);
  // Ids in the previous pending set, so a poll can tell when one has left it
  // (its tx confirmed) and auto-refresh the main feed.
  const prevPendingIdsRef = useRef<Set<string>>(new Set());
  // Kontor buys the client just made, tracked so they show as pending immediately
  // — independent of whether the server's `pending_address` decoration has picked
  // them up yet (write lag, or a failed record POST). Each is kept until the
  // server tracks-then-drops it (settled) or it ages out (see the pending effect).
  const optimisticBuysRef = useRef<
    Map<string, { swap: AtomicSwap; addedAt: number; seenByServer: boolean }>
  >(new Map());

  const [pendingSwap, setPendingSwap] = useState<AtomicSwap | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState<"buy" | "sell">(
    "buy",
  );

  const fetchSeqRef = useRef(0);
  // Swap ids removed after a buy/delist. Kept out of the list even if a lagging
  // indexer still returns them as unfilled on a subsequent fetch.
  const dismissedIdsRef = useRef<Set<string>>(new Set());

  // Kontor is signet-only. Without `kontorNetwork="signet"` on the provider, a
  // `listingType: "kontor"` query returns nothing, so skip it and let the UI
  // show a "signet only" notice instead.
  const kontorUnavailable =
    listingType === "kontor" && kontorNetwork !== "signet";

  const setListingType = useCallback((t: SwapListingType | null) => {
    setListingTypeState(t);
    setPageState(0);
  }, []);

  const setSortOption = useCallback((o: SortOption) => {
    setSortOptionState(o);
    setPageState(0);
  }, []);

  // "My swaps" and "Sold" are independent dimensions, not mutually exclusive:
  // "Sold" switches the feed from open listings to completed sales, and
  // "My swaps" narrows whichever feed to the connected wallet's own orders. So
  // "Sold" alone is everyone's sales, and "Sold" + "My swaps" is just mine.
  const setShowMySwaps = useCallback((v: boolean) => {
    setShowMySwapsState(v);
    setPageState(0);
  }, []);

  const setShowSold = useCallback((v: boolean) => {
    setShowSoldState(v);
    setPageState(0);
  }, []);

  const setPriceRange = useCallback(
    (min: number | null, max: number | null) => {
      setPriceMinState(min);
      setPriceMaxState(max);
      setPageState(0);
    },
    [],
  );

  const setCollection = useCallback((slug: string | null) => {
    setCollectionState(slug);
    setPageState(0);
  }, []);

  const setPage = useCallback((p: number) => {
    setPageState(p);
  }, []);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  const removeSwap = useCallback((swapId: string) => {
    dismissedIdsRef.current.add(swapId);
    setSwaps((prev) => {
      const next = prev.filter((s) => s.id !== swapId);
      if (next.length !== prev.length) setTotal((t) => Math.max(0, t - 1));
      return next;
    });
  }, []);

  const trackPendingBuy = useCallback(
    (swap: AtomicSwap, txid: string | null) => {
      const row: AtomicSwap = {
        ...swap,
        pendingRole: "buyer",
        pendingTxid: txid,
      };
      optimisticBuysRef.current.set(swap.id, {
        swap: row,
        addedAt: Date.now(),
        seenByServer: false,
      });
      // Surface it now (don't wait for the next poll) and kick the poll on — the
      // while-pending interval only runs while `pendingOrders` is non-empty.
      setPendingOrders((prev) =>
        prev.some((s) => s.id === swap.id) ? prev : [row, ...prev],
      );
      setPendingRefreshKey((k) => k + 1);
    },
    [],
  );

  // Drop "My swaps" when the user logs out (it needs the wallet's addresses).
  // "Sold" stays: it's a public feed of everyone's sales, so logging out just
  // degrades "my sales" to "all sales" rather than clearing the filter.
  useEffect(() => {
    if (addresses) return;
    setShowMySwapsState(false);
  }, [addresses]);

  useEffect(() => {
    if (isLoading) return;
    const clamped = clampPage(page, total, limit);
    if (clamped !== page) setPageState(clamped);
  }, [total, page, limit, isLoading]);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;

    if (kontorUnavailable) {
      setIsLoading(false);
      setError(null);
      setSwaps([]);
      setTotal(0);
      setLastFetchedAt(Date.now());
      return;
    }

    setIsLoading(true);
    setError(null);

    const sort = SORT_MAP[sortOption];
    const filters = {
      listingType: listingType ?? undefined,
      priceMin: priceMin ?? undefined,
      priceMax: priceMax ?? undefined,
      collection: collection ?? undefined,
    };
    const baseParams = showSold
      ? {
          ...filters,
          orderBy: sort.orderBy,
          order: sort.order,
          sales: true,
        }
      : {
          ...filters,
          orderBy: sort.orderBy,
          order: sort.order,
          filled: false,
          delisted: false,
          funded: true,
        };

    // The seller filter is driven by "My swaps" ONLY — never by "Sold". "Sold"
    // shows the whole marketplace's completed sales; adding "My swaps" narrows
    // them to the connected wallet's own sales.
    const sellerAddresses =
      showMySwaps && addresses ? getSellerAddresses(addresses) : [];

    const applyResult = (items: AtomicSwap[], count: number) => {
      if (seq !== fetchSeqRef.current) return;
      const dismissed = dismissedIdsRef.current;
      // Drop swaps that aren't purchasable: `pending` (a buy tx is already in the
      // mempool) or `anomalous`. The marketplace query can't exclude these
      // server-side — `listSwaps` has no `pending` filter — so once the indexer
      // flags a just-bought swap `pending`, it keeps coming back in the feed. This
      // guard hides it and, unlike the in-memory `removeSwap`, survives a reload.
      // Skip this in Sold mode: every row there is already `filled`, and a lagging
      // cleanup of its (now historical) `pending_sale` row or a later `anomalous`
      // flag must not erase it from the seller's own sale history.
      const filtered = showSold
        ? items.filter((s) => !dismissed.has(s.id))
        : items.filter(
            (s) => !s.pending && !s.anomalous && !dismissed.has(s.id),
          );
      setSwaps(filtered);
      setTotal(count - (items.length - filtered.length));
      // Stamp freshness on SUCCESS only (not in finish()/finally), so a failed
      // fetch doesn't show "Updated just now" next to stale data + an error banner.
      setLastFetchedAt(Date.now());
    };

    const applyError = (err: unknown) => {
      if (seq !== fetchSeqRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    };

    const finish = () => {
      if (seq === fetchSeqRef.current) setIsLoading(false);
    };

    if (sellerAddresses.length > 1) {
      void Promise.all(
        sellerAddresses.map((sellerAddress) =>
          client.listSwaps({
            ...baseParams,
            sellerAddress,
            offset: 0,
            limit: MY_SWAPS_MERGE_FETCH_LIMIT,
          }),
        ),
      )
        .then((results) => {
          const merged = sortSwaps(
            mergeSwapsById(results.map((r) => r.atomicSwaps)),
            sort.orderBy,
            sort.order,
          );
          const { items, total: mergedTotal } = paginateSwaps(
            merged,
            page,
            limit,
          );
          applyResult(items, mergedTotal);
        })
        .catch(applyError)
        .finally(finish);
      return;
    }

    client
      .listSwaps({
        ...baseParams,
        sellerAddress: sellerAddresses[0],
        offset: page * limit,
        limit,
      })
      .then((result) => {
        applyResult(result.atomicSwaps, result.pagination.total);
      })
      .catch(applyError)
      .finally(finish);
  }, [
    client,
    listingType,
    sortOption,
    showMySwaps,
    showSold,
    priceMin,
    priceMax,
    collection,
    addresses,
    page,
    limit,
    refreshKey,
    kontorUnavailable,
  ]);

  // Reactive facet counts for the current filter set (opt-in via `includeFacets`).
  // One `getSwapFacets` request per filter change — never one per option — using
  // the SAME filters as the main feed, so the counts describe the exact set the
  // grid shows. `getSwapFacets` ignores sort/pagination, so those are omitted.
  // The request is seq-guarded so a slow earlier response can't overwrite a newer
  // one, the last-known counts stay visible while the next is in flight (no
  // flicker to empty), and a failure is swallowed — it must never surface the
  // main list's error banner. Runs independently of the "My swaps" seller filter
  // (facets describe the public marketplace set for the current filters).
  useEffect(() => {
    if (!includeFacets) {
      setFacets(null);
      setFacetsLoading(false);
      return;
    }
    const seq = ++facetsFetchSeqRef.current;
    setFacetsLoading(true);

    const facetFilters = {
      listingType: listingType ?? undefined,
      priceMin: priceMin ?? undefined,
      priceMax: priceMax ?? undefined,
      collection: collection ?? undefined,
    };
    const facetParams: SwapFacetsParams = showSold
      ? { ...facetFilters, sales: true }
      : { ...facetFilters, filled: false, delisted: false, funded: true };

    client
      .getSwapFacets(facetParams)
      .then((result) => {
        if (seq === facetsFetchSeqRef.current) setFacets(result);
      })
      .catch(() => {
        // Keep the last-known counts on a transient failure; the next filter
        // change (or refresh) retries. Never surface the main error banner.
      })
      .finally(() => {
        if (seq === facetsFetchSeqRef.current) setFacetsLoading(false);
      });
  }, [
    client,
    includeFacets,
    listingType,
    showSold,
    priceMin,
    priceMax,
    collection,
    refreshKey,
  ]);

  // Fetch the connected wallet's in-progress orders via the API's
  // `pending_address`: its pending sell listings (still settling on-chain) and
  // pending purchases (buy tx broadcast but unconfirmed). `pending_address`
  // decorates the feed rather than filtering it — the address's orders sort to
  // the very top, each marked with `pendingRole`/`pendingTxid` — so we query
  // once per wallet address (a buy is keyed to the P2WPKH funding address, a
  // listing to whichever address holds the asset), merge, and keep only the
  // marked rows. Independent of the listingType filter / page / sort: this is a
  // personal "your orders are confirming" status area, not part of the browse.
  useEffect(() => {
    if (!includePendingOrders || !addresses) {
      setPendingOrders([]);
      prevPendingIdsRef.current = new Set();
      optimisticBuysRef.current.clear();
      return;
    }
    const seq = ++pendingFetchSeqRef.current;
    // A pending order is keyed to whichever wallet address is on it (a buy to the
    // funding address, a listing to the asset holder). One query decorates the
    // feed for ALL of the wallet's addresses at once — the API sorts their
    // in-progress orders to the top, each marked with `pendingRole`/`pendingTxid`.
    const pendingAddresses = getSellerAddresses(addresses);

    void client
      .listSwaps({
        pendingAddress: pendingAddresses,
        orderBy: "created_at",
        order: "desc",
        offset: 0,
        limit: PENDING_ORDERS_FETCH_LIMIT,
      })
      .then((result) => {
        if (seq !== pendingFetchSeqRef.current) return;
        const dismissed = dismissedIdsRef.current;
        // Keep only the API-marked rows (non-null `pendingRole`). A dismissed id
        // is normally hidden, but a just-bought Kontor order we're optimistically
        // tracking stays in the pending section even though it's dismissed from
        // the browse feed.
        const serverPending = sortSwaps(
          result.atomicSwaps,
          "created_at",
          "desc",
        ).filter(
          (s) =>
            s.pendingRole !== null &&
            (!dismissed.has(s.id) || optimisticBuysRef.current.has(s.id)),
        );
        const serverIds = new Set(serverPending.map((s) => s.id));

        // Reconcile optimistically-tracked buys: keep surfacing each until the
        // server has picked it up as pending and then dropped it (settled), or it
        // ages out (the record POST never landed but the buy has since settled).
        const now = Date.now();
        let settled = false;
        const optimisticRows: AtomicSwap[] = [];
        for (const [id, entry] of optimisticBuysRef.current) {
          if (serverIds.has(id)) {
            entry.seenByServer = true;
            continue;
          }
          if (
            entry.seenByServer ||
            now - entry.addedAt >= OPTIMISTIC_PENDING_MAX_MS
          ) {
            optimisticBuysRef.current.delete(id);
            settled = true;
            continue;
          }
          optimisticRows.push(entry.swap);
        }

        const merged = sortSwaps(
          mergeSwapsById([optimisticRows, serverPending]),
          "created_at",
          "desc",
        );

        // Detect orders that left the pending set since the last fetch: their tx
        // confirmed (a listing funded, a purchase filled), so refresh the main
        // feed once to reflect it. Ignore ids the user explicitly dismissed.
        const newIds = new Set(merged.map((s) => s.id));
        const resolved = [...prevPendingIdsRef.current].some(
          (id) => !newIds.has(id) && !dismissed.has(id),
        );
        prevPendingIdsRef.current = newIds;

        setPendingOrders(merged);
        if (resolved || settled) setRefreshKey((k) => k + 1);
        // A settled purchase is the moment KOR credits — refresh balances so it
        // appears without waiting for the 1h cache.
        if (settled) refreshBalances();
      })
      .catch(() => {
        // A failed pending fetch must not surface the main list's error banner
        // or clear the last-known set — just leave it and retry on the next
        // poll / refetch.
      });
  }, [
    client,
    addresses,
    includePendingOrders,
    refreshKey,
    pendingRefreshKey,
    refreshBalances,
  ]);

  // While any order is still confirming, re-poll so it drops out of the pending
  // section on its own once its tx confirms — at which point the fetch above
  // refreshes the main feed. The interval clears as soon as the set empties.
  useEffect(() => {
    if (!includePendingOrders || !addresses) return;
    if (pendingOrders.length === 0) return;
    const id = setInterval(
      () => setPendingRefreshKey((k) => k + 1),
      PENDING_ORDERS_POLL_MS,
    );
    return () => clearInterval(id);
  }, [includePendingOrders, addresses, pendingOrders.length]);

  const isItemMySwap = useCallback(
    (swap: AtomicSwap) => checkIsMySwap(swap, addresses),
    [addresses],
  );

  // Single entry point for opening the buy/delist confirmation modal, so the
  // `onBuyStarted`/`onDelistStarted` observers fire from one place regardless
  // of whether the modal opens directly (onItemAction) or after a login
  // (handleLoginSuccess).
  const openConfirmation = useCallback((swap: AtomicSwap, mode: "buy" | "sell") => {
    setConfirmationMode(mode);
    setConfirmationModalOpen(true);
    if (mode === "sell") analyticsRef.current.onDelistStarted?.(swap);
    else analyticsRef.current.onBuyStarted?.(swap);
  }, []);

  const onItemAction = useCallback(
    (swap: AtomicSwap) => {
      setPendingSwap(swap);
      if (!addresses) {
        analyticsRef.current.onLoginRequired?.(swap);
        setLoginModalOpen(true);
      } else if (checkIsMySwap(swap, addresses)) {
        openConfirmation(swap, "sell");
      } else {
        openConfirmation(swap, "buy");
      }
    },
    [addresses, openConfirmation],
  );

  const closeLoginModal = useCallback(() => {
    setLoginModalOpen(false);
    setPendingSwap(null);
  }, []);

  const closeConfirmationModal = useCallback(() => {
    setConfirmationModalOpen(false);
    setPendingSwap(null);
  }, []);

  const handleLoginSuccess = useCallback(
    (newAddresses: Addresses) => {
      setLoginModalOpen(false);
      if (!pendingSwap) return;
      openConfirmation(
        pendingSwap,
        checkIsMySwap(pendingSwap, newAddresses) ? "sell" : "buy",
      );
    },
    [pendingSwap, openConfirmation],
  );

  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;

  return {
    swaps,
    total,
    isLoading,
    error,
    lastFetchedAt,
    listingType,
    setListingType,
    sortOption,
    setSortOption,
    showMySwaps,
    setShowMySwaps,
    canShowMySwaps: addresses !== null,
    showSold,
    setShowSold,
    canShowSold: true,
    priceMin,
    priceMax,
    setPriceRange,
    collection,
    setCollection,
    facets,
    facetsLoading,
    kontorUnavailable,
    page,
    setPage,
    totalPages,
    refetch,
    removeSwap,
    trackPendingBuy,
    isItemMySwap,
    pendingOrders,
    pendingSwap,
    loginModalOpen,
    confirmationModalOpen,
    confirmationMode,
    onItemAction,
    closeLoginModal,
    closeConfirmationModal,
    handleLoginSuccess,
  };
}
