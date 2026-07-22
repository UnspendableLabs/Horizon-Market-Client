// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import type { AtomicSwap } from "../../types/index.js";
import { useSwapList } from "./useSwapList.js";
import { PENDING_ORDERS_POLL_MS } from "../internal/swapListConstants.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

type Client = HorizonMarketContextValue["client"];

function swap(
  overrides: Partial<AtomicSwap> & Pick<AtomicSwap, "id">,
): AtomicSwap {
  return {
    listingType: "counterparty",
    sellerAddress: "bc1qseller",
    buyerAddress: null,
    assetUtxoId: null,
    assetUtxoValue: null,
    assetName: "TEST",
    assetQuantity: 1n,
    price: 1000,
    pricePerUnit: 1000,
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
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
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

function listResult(atomicSwaps: AtomicSwap[], total = atomicSwaps.length) {
  return {
    count: total,
    atomicSwaps,
    pagination: { total, offset: 0, limit: null },
  };
}

function ctxWith(
  listSwaps: ReturnType<typeof vi.fn>,
  overrides: Partial<HorizonMarketContextValue> = {},
): HorizonMarketContextValue {
  return makeCtx({
    client: { listSwaps } as unknown as Client,
    ...overrides,
  });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

describe("useSwapList — fetch / filter / empty / error", () => {
  it("fetches on mount, filters pending + anomalous, adjusts total", async () => {
    const listSwaps = vi.fn().mockResolvedValue(
      listResult(
        [
          swap({ id: "a" }),
          swap({ id: "b", pending: true }),
          swap({ id: "c", anomalous: true }),
          swap({ id: "d" }),
        ],
        4,
      ),
    );
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.swaps.map((s) => s.id)).toEqual(["a", "d"]);
    // total = count - (items - kept) = 4 - (4 - 2) = 2
    expect(result.current.total).toBe(2);
    expect(result.current.lastFetchedAt).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        listingType: undefined,
        orderBy: "created_at",
        order: "desc",
        filled: false,
        delisted: false,
        funded: true,
        sellerAddress: undefined,
        offset: 0,
        limit: 24,
      }),
    );
  });

  it("returns empty list + zero total when there are no swaps", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([], 0));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.swaps).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("surfaces an Error rejection", async () => {
    const listSwaps = vi.fn().mockRejectedValue(new Error("boom"));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isLoading).toBe(false);
  });

  it("wraps a non-Error rejection", async () => {
    const listSwaps = vi.fn().mockRejectedValue("nope");
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("nope");
  });

  it("changing the filter resets to page 0 and re-queries with listingType", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "x" })], 100));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // totalPages derived from total/limit.
    expect(result.current.totalPages).toBe(Math.ceil(100 / 24));

    await act(async () => result.current.setPage(1));
    await waitFor(() => expect(result.current.page).toBe(1));

    await act(async () => result.current.setListingType("ordinal"));
    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.listingType).toBe("ordinal");
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ listingType: "ordinal", offset: 0 }),
    );
  });

  it("changing the sort maps to orderBy/order and resets the page", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "x" })], 10));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => result.current.setSortOption("cheapest"));
    await waitFor(() =>
      expect(listSwaps).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: "price", order: "asc" }),
      ),
    );
    expect(result.current.sortOption).toBe("cheapest");
    expect(result.current.page).toBe(0);
  });
});

describe("useSwapList — my swaps", () => {
  it("merges across two seller addresses, dedupes by id, paginates locally", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValueOnce(
        listResult([
          swap({ id: "1", createdAt: "2024-03-01T00:00:00.000Z" }),
          swap({ id: "2", createdAt: "2024-02-01T00:00:00.000Z" }),
        ]),
      )
      .mockResolvedValueOnce(
        listResult([
          swap({ id: "2", createdAt: "2024-02-01T00:00:00.000Z" }),
          swap({ id: "3", createdAt: "2024-01-01T00:00:00.000Z" }),
        ]),
      );
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ defaultShowMySwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listSwaps).toHaveBeenCalledTimes(2);
    expect(result.current.swaps.map((s) => s.id).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(result.current.total).toBe(3);
    // Each seller address queried with the merge fetch limit.
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress: "bc1qwallet",
        offset: 0,
        limit: 500,
      }),
    );
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress: "bc1pwallet",
        offset: 0,
        limit: 500,
      }),
    );
    expect(result.current.canShowMySwaps).toBe(true);
  });

  it("uses the single-seller path when the two addresses dedupe to one", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(
        listResult([swap({ id: "m1", sellerAddress: "bc1qsame" })]),
      );
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ defaultShowMySwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listSwaps).toHaveBeenCalledTimes(1);
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAddress: "bc1qsame", limit: 24 }),
    );
    expect(result.current.swaps.map((s) => s.id)).toEqual(["m1"]);
  });

  it("setShowMySwaps toggles the filter, resets the page, and re-queries by seller", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "mine" })], 5));
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.showMySwaps).toBe(false);

    await act(async () => result.current.setShowMySwaps(true));
    await waitFor(() => expect(result.current.showMySwaps).toBe(true));
    expect(result.current.page).toBe(0);
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sellerAddress: "bc1qsame" }),
    );
  });

  it("drops the 'my swaps' filter when the wallet logs out", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    ctxRef.current = ctxWith(listSwaps);

    const { result, rerender } = renderHook(() =>
      useSwapList({ defaultShowMySwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.showMySwaps).toBe(true);

    ctxRef.current = ctxWith(listSwaps, { addresses: null });
    rerender();
    await waitFor(() => expect(result.current.showMySwaps).toBe(false));
    expect(result.current.canShowMySwaps).toBe(false);
  });
});

describe("useSwapList — sold", () => {
  it("keeps sold swaps that carry a stale pending/anomalous flag (unlike the browse feed)", async () => {
    const listSwaps = vi.fn().mockResolvedValue(
      listResult(
        [
          swap({ id: "a", filled: true }),
          // A lagging pending_sale cleanup or a later reconciliation flag must
          // not erase a real historical sale from "Sold" the way it hides a
          // just-bought listing from the live browse feed.
          swap({ id: "b", filled: true, pending: true }),
          swap({ id: "c", filled: true, anomalous: true }),
        ],
        3,
      ),
    );
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ defaultShowSold: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.swaps.map((s) => s.id).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.current.total).toBe(3);
    // "Sold" on its own is the whole marketplace's sales — NOT filtered by the
    // connected wallet's seller address.
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({ sales: true, sellerAddress: undefined }),
    );
  });

  it("Sold + My swaps merges across two seller addresses with sales:true, dedupes by id", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValueOnce(
        listResult([
          swap({ id: "1", filled: true, createdAt: "2024-03-01T00:00:00.000Z" }),
          swap({ id: "2", filled: true, createdAt: "2024-02-01T00:00:00.000Z" }),
        ]),
      )
      .mockResolvedValueOnce(
        listResult([
          swap({ id: "2", filled: true, createdAt: "2024-02-01T00:00:00.000Z" }),
          swap({ id: "3", filled: true, createdAt: "2024-01-01T00:00:00.000Z" }),
        ]),
      );
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ defaultShowSold: true, defaultShowMySwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(listSwaps).toHaveBeenCalledTimes(2);
    expect(result.current.swaps.map((s) => s.id).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(result.current.total).toBe(3);
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress: "bc1qwallet",
        sales: true,
        offset: 0,
        limit: 500,
      }),
    );
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress: "bc1pwallet",
        sales: true,
        offset: 0,
        limit: 500,
      }),
    );
    expect(result.current.canShowSold).toBe(true);
  });

  it("Sold and My swaps are independent: combine to 'my sales', Sold alone is everyone's", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(
        listResult([swap({ id: "sold1", filled: true })], 1),
      );
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.showSold).toBe(false);

    // "My swaps" alone → my OPEN listings (seller filter, no sales).
    await act(async () => result.current.setShowMySwaps(true));
    await waitFor(() => expect(result.current.showMySwaps).toBe(true));
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sellerAddress: "bc1qsame", filled: false }),
    );

    // + "Sold" → MY sales (seller filter AND sales:true). "My swaps" stays on —
    // the two are not mutually exclusive.
    await act(async () => result.current.setShowSold(true));
    await waitFor(() => expect(result.current.showSold).toBe(true));
    expect(result.current.showMySwaps).toBe(true);
    expect(result.current.page).toBe(0);
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sellerAddress: "bc1qsame", sales: true }),
    );

    // Turn "My swaps" off → EVERYONE's sales (sales:true, no seller filter).
    await act(async () => result.current.setShowMySwaps(false));
    await waitFor(() => expect(result.current.showMySwaps).toBe(false));
    expect(result.current.showSold).toBe(true);
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ sales: true, sellerAddress: undefined }),
    );
  });

  it("keeps 'Sold' (public feed) but drops 'My swaps' when the wallet logs out", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result, rerender } = renderHook(() =>
      useSwapList({ defaultShowSold: true, defaultShowMySwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.showSold).toBe(true);
    expect(result.current.showMySwaps).toBe(true);

    ctxRef.current = ctxWith(listSwaps, { addresses: null });
    rerender();
    // "My swaps" needs the wallet's addresses, so it drops; "Sold" is public and
    // survives — logging out just degrades "my sales" to "all sales".
    await waitFor(() => expect(result.current.showMySwaps).toBe(false));
    expect(result.current.showSold).toBe(true);
    expect(result.current.canShowSold).toBe(true);
  });
});

describe("useSwapList — kontor availability", () => {
  it("skips the query and shows nothing when kontor is unavailable", async () => {
    const listSwaps = vi.fn();
    ctxRef.current = ctxWith(listSwaps); // kontorNetwork undefined

    const { result } = renderHook(() =>
      useSwapList({ defaultListingType: "kontor" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kontorUnavailable).toBe(true);
    expect(result.current.swaps).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.lastFetchedAt).not.toBeNull();
    expect(listSwaps).not.toHaveBeenCalled();
  });

  it("queries kontor listings when kontorNetwork is signet", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "k1", listingType: "kontor" })]));
    ctxRef.current = ctxWith(listSwaps, { kontorNetwork: "signet" });

    const { result } = renderHook(() =>
      useSwapList({ defaultListingType: "kontor" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kontorUnavailable).toBe(false);
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({ listingType: "kontor" }),
    );
    expect(result.current.swaps.map((s) => s.id)).toEqual(["k1"]);
  });
});

describe("useSwapList — removeSwap / refetch / pagination clamp", () => {
  it("removeSwap drops the item, decrements total, and survives a lagging refetch", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "a" }), swap({ id: "b" })], 2));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.total).toBe(2));

    await act(async () => result.current.removeSwap("a"));
    expect(result.current.swaps.map((s) => s.id)).toEqual(["b"]);
    expect(result.current.total).toBe(1);

    // Removing an id not in the list leaves the total untouched.
    await act(async () => result.current.removeSwap("zzz"));
    expect(result.current.total).toBe(1);

    // A lagging indexer still returns "a"; it must stay dismissed on refetch.
    await act(async () => result.current.refetch());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.swaps.map((s) => s.id)).toEqual(["b"]);
    expect(result.current.total).toBe(1);
  });

  it("clamps the page back into range when the total shrinks after a fetch", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValueOnce(listResult([swap({ id: "a" })], 10))
      .mockResolvedValue(listResult([swap({ id: "b" })], 2));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList({ limit: 2 }));
    await waitFor(() => expect(result.current.total).toBe(10));

    await act(async () => result.current.setPage(3));
    // The page-3 fetch returns a total of 2 → maxPage 0 → clamps to 0.
    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.total).toBe(2);
  });

  it("totalPages is 1 when limit is non-positive", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([], 0));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList({ limit: 0 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.totalPages).toBe(1);
  });
});

describe("useSwapList — item action + modals", () => {
  async function mounted(overrides: Partial<HorizonMarketContextValue> = {}) {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    ctxRef.current = ctxWith(listSwaps, overrides);
    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    return result;
  }

  it("opens the login modal when acting while logged out", async () => {
    const result = await mounted({ addresses: null });
    await act(async () => result.current.onItemAction(swap({ id: "s1" })));
    expect(result.current.loginModalOpen).toBe(true);
    expect(result.current.confirmationModalOpen).toBe(false);
    expect(result.current.pendingSwap?.id).toBe("s1");

    await act(async () => result.current.closeLoginModal());
    expect(result.current.loginModalOpen).toBe(false);
    expect(result.current.pendingSwap).toBeNull();
  });

  it("opens the sell confirmation for the viewer's own listing", async () => {
    const result = await mounted({
      addresses: { p2wpkh: "bc1qme", p2tr: "bc1pme", publicKey: "02aa" },
    });
    await act(async () =>
      result.current.onItemAction(swap({ id: "s2", sellerAddress: "bc1qme" })),
    );
    expect(result.current.confirmationModalOpen).toBe(true);
    expect(result.current.confirmationMode).toBe("sell");
    expect(result.current.loginModalOpen).toBe(false);

    await act(async () => result.current.closeConfirmationModal());
    expect(result.current.confirmationModalOpen).toBe(false);
    expect(result.current.pendingSwap).toBeNull();
  });

  it("opens the buy confirmation for someone else's listing", async () => {
    const result = await mounted({
      addresses: { p2wpkh: "bc1qme", p2tr: "bc1pme", publicKey: "02aa" },
    });
    await act(async () =>
      result.current.onItemAction(swap({ id: "s3", sellerAddress: "bc1qother" })),
    );
    expect(result.current.confirmationModalOpen).toBe(true);
    expect(result.current.confirmationMode).toBe("buy");
  });

  it("isItemMySwap matches the connected addresses", async () => {
    const result = await mounted({
      addresses: { p2wpkh: "bc1qme", p2tr: "bc1pme", publicKey: "02aa" },
    });
    expect(
      result.current.isItemMySwap(swap({ id: "a", sellerAddress: "bc1qme" })),
    ).toBe(true);
    expect(
      result.current.isItemMySwap(swap({ id: "b", sellerAddress: "bc1pme" })),
    ).toBe(true);
    expect(
      result.current.isItemMySwap(swap({ id: "c", sellerAddress: "bc1qx" })),
    ).toBe(false);
  });

  it("handleLoginSuccess routes a pending swap to the right confirmation mode", async () => {
    const result = await mounted({ addresses: null });
    await act(async () =>
      result.current.onItemAction(swap({ id: "s4", sellerAddress: "bc1qme" })),
    );
    expect(result.current.loginModalOpen).toBe(true);

    await act(async () =>
      result.current.handleLoginSuccess({
        p2wpkh: "bc1qme",
        p2tr: "bc1pme",
        publicKey: "02aa",
      }),
    );
    expect(result.current.loginModalOpen).toBe(false);
    expect(result.current.confirmationModalOpen).toBe(true);
    expect(result.current.confirmationMode).toBe("sell");
  });

  it("handleLoginSuccess picks buy mode for a foreign pending swap", async () => {
    const result = await mounted({ addresses: null });
    await act(async () =>
      result.current.onItemAction(swap({ id: "s5", sellerAddress: "bc1qseller" })),
    );
    await act(async () =>
      result.current.handleLoginSuccess({
        p2wpkh: "bc1qme",
        p2tr: "bc1pme",
        publicKey: "02aa",
      }),
    );
    expect(result.current.confirmationMode).toBe("buy");
    expect(result.current.confirmationModalOpen).toBe(true);
  });

  it("handleLoginSuccess is a no-op confirmation when nothing is pending", async () => {
    const result = await mounted({ addresses: null });
    await act(async () =>
      result.current.handleLoginSuccess({
        p2wpkh: "bc1qme",
        p2tr: "bc1pme",
        publicKey: "02aa",
      }),
    );
    expect(result.current.loginModalOpen).toBe(false);
    expect(result.current.confirmationModalOpen).toBe(false);
  });
});

describe("useSwapList — pending orders", () => {
  // The pending-orders fetch is the one that passes `pendingAddress`; the main
  // buy feed never does. Route the two to distinct result sets so a single mock
  // serves both. Pending rows must carry a non-null `pendingRole` — that's what
  // the hook keeps (the API marks an address's in-progress orders and returns
  // ordinary browse rows with `pendingRole: null`).
  function splitListSwaps(pending: AtomicSwap[], feed: AtomicSwap[] = []) {
    return vi.fn((params: { pendingAddress?: string | string[] }) =>
      Promise.resolve(
        params.pendingAddress !== undefined
          ? listResult(pending)
          : listResult(feed),
      ),
    );
  }

  const pendingSeller = (id: string, overrides: Partial<AtomicSwap> = {}) =>
    swap({ id, funded: false, pendingRole: "seller", ...overrides });

  it("is off by default: no pending_address query, empty pendingOrders", async () => {
    const listSwaps = splitListSwaps([pendingSeller("p1")]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pendingOrders).toEqual([]);
    expect(
      listSwaps.mock.calls.some((c) => c[0]?.pendingAddress !== undefined),
    ).toBe(false);
  });

  it("fetches in-progress orders for all wallet addresses in one query, newest first", async () => {
    const listSwaps = splitListSwaps([
      pendingSeller("p-old", { createdAt: "2024-01-01T00:00:00.000Z" }),
      pendingSeller("p-new", { createdAt: "2024-03-01T00:00:00.000Z" }),
    ]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOrders.length).toBeGreaterThan(0),
    );

    // Deduped by id, sorted newest first.
    expect(result.current.pendingOrders.map((s) => s.id)).toEqual([
      "p-new",
      "p-old",
    ]);
    // Both wallet addresses go out in a single pending query (not one per address).
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingAddress: ["bc1qwallet", "bc1pwallet"],
        orderBy: "created_at",
        order: "desc",
      }),
    );
    const pendingCalls = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress !== undefined,
    );
    expect(pendingCalls).toHaveLength(1);
  });

  it("surfaces both pending sell orders and pending purchases", async () => {
    const listSwaps = splitListSwaps([
      pendingSeller("sell", { createdAt: "2024-01-01T00:00:00.000Z" }),
      swap({
        id: "buy",
        pendingRole: "buyer",
        createdAt: "2024-02-01T00:00:00.000Z",
      }),
    ]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() => expect(result.current.pendingOrders.length).toBe(2));
    // Sorted newest first: the buy (Feb) precedes the listing (Jan).
    expect(result.current.pendingOrders.map((s) => s.pendingRole)).toEqual([
      "buyer",
      "seller",
    ]);
  });

  it("optimistically surfaces a tracked Kontor buy before the server marks it pending", async () => {
    const listSwaps = splitListSwaps([]); // server has no pending_sale for it yet
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pendingOrders).toEqual([]);

    act(() => {
      result.current.trackPendingBuy(
        swap({ id: "kbuy", listingType: "kontor" }),
        "txabc",
      );
    });

    await waitFor(() =>
      expect(result.current.pendingOrders.map((s) => s.id)).toContain("kbuy"),
    );
    const row = result.current.pendingOrders.find((s) => s.id === "kbuy")!;
    expect(row.pendingRole).toBe("buyer");
    expect(row.pendingTxid).toBe("txabc");
  });

  it("reconciles a tracked buy away once it settles, and refreshes balances", async () => {
    let serverPending: AtomicSwap[] = [
      swap({ id: "kbuy", pendingRole: "buyer", pendingTxid: "txabc" }),
    ];
    const listSwaps = vi.fn(
      (params: { pendingAddress?: string | string[] }) =>
        Promise.resolve(
          listResult(params.pendingAddress !== undefined ? serverPending : []),
        ),
    );
    const refreshBalances = vi.fn();
    ctxRef.current = ctxWith(listSwaps, { refreshBalances });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.trackPendingBuy(swap({ id: "kbuy" }), "txabc");
    });
    // The server tracks it (pending_role: buyer) → shown.
    await waitFor(() =>
      expect(result.current.pendingOrders.map((s) => s.id)).toContain("kbuy"),
    );

    // The buy confirms: the server drops it from the pending set.
    serverPending = [];
    act(() => result.current.refetch());

    await waitFor(() =>
      expect(result.current.pendingOrders.map((s) => s.id)).not.toContain(
        "kbuy",
      ),
    );
    expect(refreshBalances).toHaveBeenCalled();
  });

  it("keeps the main feed and pending sets disjoint and unaffected", async () => {
    const listSwaps = splitListSwaps([pendingSeller("p1")], [swap({ id: "m1" })]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["p1"]),
    );
    expect(result.current.swaps.map((s) => s.id)).toEqual(["m1"]);
  });

  it("keeps only the rows the API marked pending (pendingRole set)", async () => {
    // `pending_address` decorates the feed: the address's in-progress orders come
    // back marked, ordinary browse rows come back with `pendingRole: null`. Only
    // the marked rows belong in the pending section.
    const listSwaps = splitListSwaps([
      pendingSeller("keep"),
      swap({ id: "browse-a", pendingRole: null }),
      swap({ id: "browse-b", pendingRole: null }),
    ]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOrders.length).toBeGreaterThan(0),
    );
    expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["keep"]);
  });

  it("clears pending orders when the wallet logs out", async () => {
    const listSwaps = splitListSwaps([pendingSeller("p1")]);
    ctxRef.current = ctxWith(listSwaps);

    const { result, rerender } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["p1"]),
    );

    ctxRef.current = ctxWith(listSwaps, { addresses: null });
    rerender();
    await waitFor(() => expect(result.current.pendingOrders).toEqual([]));
  });

  it("re-polls pending orders while any remain", async () => {
    vi.useFakeTimers();
    // Single deduped wallet address → one query per fetch, simpler call counts.
    const listSwaps = splitListSwaps([pendingSeller("p1")]);
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );

    // Flush the initial fetches without firing the poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["p1"]);

    const pendingCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress !== undefined,
    ).length;

    // One poll tick re-queries the pending set.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ORDERS_POLL_MS);
    });
    const pendingCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress !== undefined,
    ).length;
    expect(pendingCallsAfter).toBeGreaterThan(pendingCallsBefore);
  });

  it("auto-refreshes the main feed when a pending order confirms", async () => {
    vi.useFakeTimers();
    // The pending query returns the order on the first poll, then empty (its tx
    // confirmed). The main feed query is counted to prove it re-fetches on the
    // transition.
    let pendingCalls = 0;
    const listSwaps = vi.fn((params: { pendingAddress?: string }) => {
      if (params.pendingAddress !== undefined) {
        pendingCalls += 1;
        return Promise.resolve(
          listResult(pendingCalls <= 1 ? [pendingSeller("p1")] : []),
        );
      }
      return Promise.resolve(listResult([]));
    });
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["p1"]);
    const feedCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress === undefined,
    ).length;

    // Poll: the order is no longer pending → main feed refetches once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ORDERS_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.pendingOrders).toEqual([]);
    const feedCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress === undefined,
    ).length;
    expect(feedCallsAfter).toBeGreaterThan(feedCallsBefore);
  });

  it("does not refresh the main feed when the pending set is unchanged", async () => {
    vi.useFakeTimers();
    // The same order stays pending across polls — no transition, no refetch.
    const listSwaps = vi.fn((params: { pendingAddress?: string }) =>
      Promise.resolve(
        params.pendingAddress !== undefined
          ? listResult([pendingSeller("p1")])
          : listResult([]),
      ),
    );
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOrders: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const feedCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress === undefined,
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ORDERS_POLL_MS);
    });
    // Still pending, unchanged → the feed query count is untouched by the poll.
    expect(result.current.pendingOrders.map((s) => s.id)).toEqual(["p1"]);
    const feedCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress === undefined,
    ).length;
    expect(feedCallsAfter).toBe(feedCallsBefore);
  });

  it("stops polling once no pending orders remain", async () => {
    vi.useFakeTimers();
    const listSwaps = splitListSwaps([]); // nothing pending
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    renderHook(() => useSwapList({ includePendingOrders: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const before = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress !== undefined,
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_ORDERS_POLL_MS * 3);
    });
    const after = listSwaps.mock.calls.filter(
      (c) => c[0]?.pendingAddress !== undefined,
    ).length;
    // No poll scheduled when the pending set is empty.
    expect(after).toBe(before);
  });
});

describe("useSwapList — price / collection filters", () => {
  it("threads priceMin/priceMax/collection into the listSwaps query", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "a" })], 100));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({
        defaultPriceMin: 1000,
        defaultPriceMax: 5000,
        defaultCollection: "punks",
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.priceMin).toBe(1000);
    expect(result.current.priceMax).toBe(5000);
    expect(result.current.collection).toBe("punks");
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        priceMin: 1000,
        priceMax: 5000,
        collection: "punks",
      }),
    );
  });

  it("omits unset price/collection bounds (undefined, not null) in the query", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([], 0));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.priceMin).toBeNull();
    expect(result.current.priceMax).toBeNull();
    expect(result.current.collection).toBeNull();
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        priceMin: undefined,
        priceMax: undefined,
        collection: undefined,
      }),
    );
  });

  it("setPriceRange updates both bounds, re-queries, and resets to page 0", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "a" })], 100));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));

    await act(async () => result.current.setPriceRange(2000, null));
    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.priceMin).toBe(2000);
    expect(result.current.priceMax).toBeNull();
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        priceMin: 2000,
        priceMax: undefined,
        offset: 0,
      }),
    );
  });

  it("setCollection updates the slug, re-queries, and resets to page 0", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "a" })], 100));
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => result.current.setPage(1));
    await waitFor(() => expect(result.current.page).toBe(1));

    await act(async () => result.current.setCollection("bitcoin-frogs"));
    await waitFor(() => expect(result.current.page).toBe(0));
    expect(result.current.collection).toBe("bitcoin-frogs");
    expect(listSwaps).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: "bitcoin-frogs", offset: 0 }),
    );

    // Clearing it back to null drops the filter (undefined in the query).
    await act(async () => result.current.setCollection(null));
    await waitFor(() =>
      expect(listSwaps).toHaveBeenLastCalledWith(
        expect.objectContaining({ collection: undefined }),
      ),
    );
    expect(result.current.collection).toBeNull();
  });
});

describe("useSwapList — facets", () => {
  function facetsFixture(counterparty = 0) {
    return {
      type: { counterparty, ordinal: 0, zeld: 0, kontor: 0 },
      price: [],
      collection: [],
    };
  }

  function ctxWithFacets(
    listSwaps: ReturnType<typeof vi.fn>,
    getSwapFacets: ReturnType<typeof vi.fn>,
    overrides: Partial<HorizonMarketContextValue> = {},
  ): HorizonMarketContextValue {
    return makeCtx({
      client: { listSwaps, getSwapFacets } as unknown as Client,
      ...overrides,
    });
  }

  it("does not fetch facets unless includeFacets is set", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    const getSwapFacets = vi.fn().mockResolvedValue(facetsFixture());
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getSwapFacets).not.toHaveBeenCalled();
    expect(result.current.facets).toBeNull();
    expect(result.current.facetsLoading).toBe(false);
  });

  it("fetches facets with the SAME filters as the feed, minus sort/pagination", async () => {
    const facets = facetsFixture(3);
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    const getSwapFacets = vi.fn().mockResolvedValue(facets);
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() =>
      useSwapList({
        includeFacets: true,
        defaultListingType: "ordinal",
        defaultPriceMin: 1000,
        defaultCollection: "punks",
      }),
    );
    await waitFor(() => expect(result.current.facets).not.toBeNull());

    expect(result.current.facets).toEqual(facets);
    expect(getSwapFacets).toHaveBeenCalledWith(
      expect.objectContaining({
        listingType: "ordinal",
        priceMin: 1000,
        collection: "punks",
        filled: false,
        delisted: false,
        funded: true,
      }),
    );
    // Facet counts ignore sort + pagination — those fields must not be sent.
    const params = getSwapFacets.mock.calls[0][0];
    expect(params).not.toHaveProperty("orderBy");
    expect(params).not.toHaveProperty("order");
    expect(params).not.toHaveProperty("offset");
    expect(params).not.toHaveProperty("limit");
  });

  it("queries sold-mode facets with sales:true", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    const getSwapFacets = vi.fn().mockResolvedValue(facetsFixture());
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() =>
      useSwapList({ includeFacets: true, defaultShowSold: true }),
    );
    await waitFor(() => expect(result.current.facets).not.toBeNull());

    expect(getSwapFacets).toHaveBeenCalledWith(
      expect.objectContaining({ sales: true }),
    );
    const params = getSwapFacets.mock.calls[0][0];
    expect(params).not.toHaveProperty("funded");
  });

  it("re-fetches facets on a filter change (one request per change)", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    const getSwapFacets = vi.fn().mockResolvedValue(facetsFixture());
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() => useSwapList({ includeFacets: true }));
    await waitFor(() => expect(getSwapFacets).toHaveBeenCalledTimes(1));

    await act(async () => result.current.setListingType("zeld"));
    await waitFor(() => expect(getSwapFacets).toHaveBeenCalledTimes(2));
    expect(getSwapFacets).toHaveBeenLastCalledWith(
      expect.objectContaining({ listingType: "zeld" }),
    );
  });

  it("ignores a stale facets response once a newer request has resolved", async () => {
    const stale = facetsFixture(1);
    const fresh = facetsFixture(2);
    let resolveStale!: (v: unknown) => void;
    const getSwapFacets = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce(fresh);
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() => useSwapList({ includeFacets: true }));
    // The mount request hangs; change a filter to fire a second, newer request.
    await act(async () => result.current.setListingType("ordinal"));
    await waitFor(() => expect(result.current.facets).toEqual(fresh));

    // The stale first request finally resolves — it must NOT overwrite `fresh`.
    await act(async () => {
      resolveStale(stale);
    });
    expect(result.current.facets).toEqual(fresh);
  });

  it("a facets failure never surfaces the main error banner", async () => {
    const listSwaps = vi
      .fn()
      .mockResolvedValue(listResult([swap({ id: "a" })], 1));
    const getSwapFacets = vi.fn().mockRejectedValue(new Error("facets boom"));
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result } = renderHook(() => useSwapList({ includeFacets: true }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.facetsLoading).toBe(false));

    // The list still resolved; the facets error is swallowed (last-known counts
    // stay, which is null here), and the main error banner never lights up.
    expect(result.current.error).toBeNull();
    expect(result.current.facets).toBeNull();
    expect(result.current.swaps.map((s) => s.id)).toEqual(["a"]);
  });

  it("clears facets and stops fetching when includeFacets flips off", async () => {
    const listSwaps = vi.fn().mockResolvedValue(listResult([]));
    const getSwapFacets = vi.fn().mockResolvedValue(facetsFixture(4));
    ctxRef.current = ctxWithFacets(listSwaps, getSwapFacets);

    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => useSwapList({ includeFacets: on }),
      { initialProps: { on: true } },
    );
    await waitFor(() => expect(result.current.facets).not.toBeNull());
    const callsBefore = getSwapFacets.mock.calls.length;

    rerender({ on: false });
    await waitFor(() => expect(result.current.facets).toBeNull());
    expect(result.current.facetsLoading).toBe(false);
    expect(getSwapFacets.mock.calls.length).toBe(callsBefore);
  });
});
