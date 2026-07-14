import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket, type Addresses } from "../context.js";
import type { AtomicSwap, ListingType } from "../../types/index.js";
import {
  MY_SWAPS_MERGE_FETCH_LIMIT,
  PENDING_OWN_SWAPS_FETCH_LIMIT,
  PENDING_OWN_SWAPS_POLL_MS,
} from "../internal/swapListConstants.js";
import {
  checkIsMySwap,
  clampPage,
  getSellerAddresses,
  mergeSwapsById,
  paginateSwaps,
  sortSwaps,
} from "../internal/swapListHelpers.js";

export type SwapListOrderBy = "created_at" | "price" | "price_per_unit";
export type SwapListOrder = "asc" | "desc";
export type SwapListingType = ListingType;
export type SortOption =
  | "latest"
  | "oldest"
  | "cheapest"
  | "expensive"
  | "cheapest_unit";

const SORT_MAP: Record<
  SortOption,
  { orderBy: SwapListOrderBy; order: SwapListOrder }
> = {
  latest: { orderBy: "created_at", order: "desc" },
  oldest: { orderBy: "created_at", order: "asc" },
  cheapest: { orderBy: "price", order: "asc" },
  expensive: { orderBy: "price", order: "desc" },
  cheapest_unit: { orderBy: "price_per_unit", order: "asc" },
};

export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  latest: "Latest first",
  oldest: "Oldest first",
  cheapest: "Cheapest first",
  expensive: "Most expensive",
  cheapest_unit: "Cheapest per unit",
};

export const SORT_OPTIONS = Object.keys(SORT_MAP) as SortOption[];

export interface UseSwapListOptions {
  defaultListingType?: SwapListingType | null;
  defaultSortOption?: SortOption;
  defaultShowMySwaps?: boolean;
  limit?: number;
  /**
   * Also fetch the connected wallet's own listings that are still awaiting
   * on-chain confirmation (`funded: false`) and expose them as
   * {@link UseSwapListResult.pendingOwnSwaps}, so the UI can surface them at the
   * top of the buy list. Off by default; the {@link SwapList} components enable
   * it. While any remain pending the set re-polls on its own (every
   * {@link PENDING_OWN_SWAPS_POLL_MS}) so the item drops out once it confirms.
   */
  includePendingOwnSwaps?: boolean;
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
  isItemMySwap: (swap: AtomicSwap) => boolean;
  /**
   * The connected wallet's own listings still awaiting on-chain confirmation
   * (`funded: false`), newest first. Empty unless {@link
   * UseSwapListOptions.includePendingOwnSwaps} is set and a wallet is connected.
   * These never overlap the main `swaps` feed (which is `funded: true`); once a
   * listing's funding tx confirms it drops from here and can be browsed normally.
   */
  pendingOwnSwaps: AtomicSwap[];
  pendingSwap: AtomicSwap | null;
  loginModalOpen: boolean;
  confirmationModalOpen: boolean;
  confirmationMode: "buy" | "sell";
  onItemAction: (swap: AtomicSwap) => void;
  closeLoginModal: () => void;
  closeConfirmationModal: () => void;
  handleLoginSuccess: (addresses: Addresses) => void;
}

const DEFAULT_LIMIT = 24;

export function useSwapList(options: UseSwapListOptions = {}): UseSwapListResult {
  const { client, addresses, kontorNetwork } = useHorizonMarket();
  const {
    defaultListingType = null,
    defaultSortOption = "latest",
    defaultShowMySwaps = false,
    limit = DEFAULT_LIMIT,
    includePendingOwnSwaps = false,
  } = options;

  const [listingType, setListingTypeState] = useState<SwapListingType | null>(
    defaultListingType,
  );
  const [sortOption, setSortOptionState] = useState<SortOption>(
    defaultSortOption,
  );
  const [showMySwaps, setShowMySwapsState] = useState(defaultShowMySwaps);
  const [page, setPageState] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [swaps, setSwaps] = useState<AtomicSwap[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // When the current list was last (re-)fetched, for an "Updated …" label.
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // The connected wallet's own awaiting-confirmation (funded:false) listings,
  // fetched separately from the main feed. `pendingRefreshKey` drives the
  // while-pending poll (below) that lets the spinner resolve without a manual
  // Refresh.
  const [pendingOwnSwaps, setPendingOwnSwaps] = useState<AtomicSwap[]>([]);
  const [pendingRefreshKey, setPendingRefreshKey] = useState(0);
  const pendingFetchSeqRef = useRef(0);
  // Ids in the previous awaiting-confirmation set, so a poll can tell when one
  // has left it (i.e. its funding tx confirmed) and auto-refresh the main feed.
  const prevPendingIdsRef = useRef<Set<string>>(new Set());

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

  const setShowMySwaps = useCallback((v: boolean) => {
    setShowMySwapsState(v);
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

  // Drop "My swaps" filter when the user logs out.
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
    const baseParams = {
      listingType: listingType ?? undefined,
      orderBy: sort.orderBy,
      order: sort.order,
      filled: false,
      delisted: false,
      funded: true,
    };

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
      const filtered = items.filter(
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
    addresses,
    page,
    limit,
    refreshKey,
    kontorUnavailable,
  ]);

  // Fetch the connected wallet's own listings still awaiting on-chain
  // confirmation (funded:false). Kept out of the main feed (funded:true) so a
  // just-created listing is visible to its creator before it's purchasable.
  // Independent of the listingType filter / page / sort — this is a personal
  // "your listings are confirming" status area, not part of the browse.
  useEffect(() => {
    if (!includePendingOwnSwaps || !addresses) {
      // eslint-disable-next-line no-console -- TEMP DEBUG (remove after diagnosis)
      console.log("[pending-swaps] skip", { includePendingOwnSwaps, addresses });
      setPendingOwnSwaps([]);
      prevPendingIdsRef.current = new Set();
      return;
    }
    const seq = ++pendingFetchSeqRef.current;
    const sellerAddresses = getSellerAddresses(addresses);
    // eslint-disable-next-line no-console -- TEMP DEBUG (remove after diagnosis)
    console.log("[pending-swaps] fetch", { sellerAddresses });

    void Promise.all(
      sellerAddresses.map((sellerAddress) =>
        client.listSwaps({
          sellerAddress,
          funded: false,
          filled: false,
          delisted: false,
          orderBy: "created_at",
          order: "desc",
          offset: 0,
          limit: PENDING_OWN_SWAPS_FETCH_LIMIT,
        }),
      ),
    )
      .then((results) => {
        if (seq !== pendingFetchSeqRef.current) return;
        // eslint-disable-next-line no-console -- TEMP DEBUG (remove after diagnosis)
        console.log(
          "[pending-swaps] raw",
          results.flatMap((r) =>
            r.atomicSwaps.map((s) => ({
              id: s.id,
              seller: s.sellerAddress,
              funded: s.funded,
              filled: s.filled,
              delisted: s.delisted,
              expired: s.expired,
              anomalous: s.anomalous,
              type: s.listingType,
            })),
          ),
        );
        const dismissed = dismissedIdsRef.current;
        const merged = sortSwaps(
          mergeSwapsById(results.map((r) => r.atomicSwaps)),
          "created_at",
          "desc",
        ).filter(
          (s) =>
            !s.funded &&
            !s.filled &&
            !s.delisted &&
            !s.expired &&
            !s.anomalous &&
            !dismissed.has(s.id),
        );
        // eslint-disable-next-line no-console -- TEMP DEBUG (remove after diagnosis)
        console.log("[pending-swaps] shown", merged.map((s) => s.id));

        // Detect listings that left the awaiting set since the last fetch: their
        // funding tx confirmed (or they were delisted/expired), so refresh the
        // main feed once to surface the now-live listing. Ignore ids the user
        // explicitly dismissed (delist) so those don't force a needless refetch.
        const newIds = new Set(merged.map((s) => s.id));
        const resolved = [...prevPendingIdsRef.current].some(
          (id) => !newIds.has(id) && !dismissed.has(id),
        );
        prevPendingIdsRef.current = newIds;

        setPendingOwnSwaps(merged);
        if (resolved) setRefreshKey((k) => k + 1);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console -- TEMP DEBUG (remove after diagnosis)
        console.log("[pending-swaps] error", err);
        // A failed pending-listings fetch must not surface the main list's error
        // banner or clear the last-known set — just leave it and retry on the
        // next poll / refetch.
      });
  }, [client, addresses, includePendingOwnSwaps, refreshKey, pendingRefreshKey]);

  // While any own listing is still confirming, re-poll so it drops out of the
  // pending section on its own once funded — at which point the fetch above
  // refreshes the main feed so the newly-live listing appears there. The
  // interval clears as soon as the set empties.
  useEffect(() => {
    if (!includePendingOwnSwaps || !addresses) return;
    if (pendingOwnSwaps.length === 0) return;
    const id = setInterval(
      () => setPendingRefreshKey((k) => k + 1),
      PENDING_OWN_SWAPS_POLL_MS,
    );
    return () => clearInterval(id);
  }, [includePendingOwnSwaps, addresses, pendingOwnSwaps.length]);

  const isItemMySwap = useCallback(
    (swap: AtomicSwap) => checkIsMySwap(swap, addresses),
    [addresses],
  );

  const onItemAction = useCallback(
    (swap: AtomicSwap) => {
      setPendingSwap(swap);
      if (!addresses) {
        setLoginModalOpen(true);
      } else if (checkIsMySwap(swap, addresses)) {
        setConfirmationMode("sell");
        setConfirmationModalOpen(true);
      } else {
        setConfirmationMode("buy");
        setConfirmationModalOpen(true);
      }
    },
    [addresses],
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
      if (checkIsMySwap(pendingSwap, newAddresses)) {
        setConfirmationMode("sell");
      } else {
        setConfirmationMode("buy");
      }
      setConfirmationModalOpen(true);
    },
    [pendingSwap],
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
    kontorUnavailable,
    page,
    setPage,
    totalPages,
    refetch,
    removeSwap,
    isItemMySwap,
    pendingOwnSwaps,
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
