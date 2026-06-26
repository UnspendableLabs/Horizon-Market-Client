import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket, type Addresses } from "../context.js";
import type { AtomicSwap, ListingType } from "../../types/index.js";
import { MY_SWAPS_MERGE_FETCH_LIMIT } from "../internal/swapListConstants.js";
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
}

export interface UseSwapListResult {
  swaps: AtomicSwap[];
  total: number;
  isLoading: boolean;
  error: Error | null;
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
  isItemMySwap: (swap: AtomicSwap) => boolean;
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

  const [pendingSwap, setPendingSwap] = useState<AtomicSwap | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [confirmationModalOpen, setConfirmationModalOpen] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState<"buy" | "sell">(
    "buy",
  );

  const fetchSeqRef = useRef(0);

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
      setSwaps(items);
      setTotal(count);
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
    isItemMySwap,
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
