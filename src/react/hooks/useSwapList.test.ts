// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import type { AtomicSwap } from "../../types/index.js";
import { useSwapList } from "./useSwapList.js";
import { PENDING_OWN_SWAPS_POLL_MS } from "../internal/swapListConstants.js";

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

describe("useSwapList — pending own swaps", () => {
  // Routes the buy feed (funded:true) and the own-pending query (funded:false)
  // to distinct result sets so a single mock serves both fetches.
  function splitListSwaps(pending: AtomicSwap[], feed: AtomicSwap[] = []) {
    return vi.fn((params: { funded?: boolean }) =>
      Promise.resolve(
        params.funded === false ? listResult(pending) : listResult(feed),
      ),
    );
  }

  it("is off by default: no funded:false query, empty pendingOwnSwaps", async () => {
    const listSwaps = splitListSwaps([swap({ id: "p1", funded: false })]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() => useSwapList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pendingOwnSwaps).toEqual([]);
    expect(
      listSwaps.mock.calls.some((c) => c[0]?.funded === false),
    ).toBe(false);
  });

  it("fetches own funded:false listings across seller addresses, newest first", async () => {
    const listSwaps = splitListSwaps([
      swap({ id: "p-old", funded: false, createdAt: "2024-01-01T00:00:00.000Z" }),
      swap({ id: "p-new", funded: false, createdAt: "2024-03-01T00:00:00.000Z" }),
    ]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOwnSwaps.length).toBeGreaterThan(0),
    );

    // Two distinct seller addresses → deduped by id, sorted newest first.
    expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual([
      "p-new",
      "p-old",
    ]);
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAddress: "bc1qwallet",
        funded: false,
        filled: false,
        delisted: false,
        orderBy: "created_at",
        order: "desc",
      }),
    );
    expect(listSwaps).toHaveBeenCalledWith(
      expect.objectContaining({ sellerAddress: "bc1pwallet", funded: false }),
    );
  });

  it("keeps the main feed and pending sets disjoint and unaffected", async () => {
    const listSwaps = splitListSwaps(
      [swap({ id: "p1", funded: false })],
      [swap({ id: "m1" })],
    );
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() =>
      expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["p1"]),
    );
    expect(result.current.swaps.map((s) => s.id)).toEqual(["m1"]);
  });

  it("defensively drops funded/filled/delisted/expired/anomalous rows", async () => {
    const listSwaps = splitListSwaps([
      swap({ id: "keep", funded: false }),
      swap({ id: "funded", funded: true }),
      swap({ id: "filled", funded: false, filled: true }),
      swap({ id: "delisted", funded: false, delisted: true }),
      swap({ id: "expired", funded: false, expired: true }),
      swap({ id: "anomalous", funded: false, anomalous: true }),
    ]);
    ctxRef.current = ctxWith(listSwaps);

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOwnSwaps.length).toBeGreaterThan(0),
    );
    expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["keep"]);
  });

  it("clears pending listings when the wallet logs out", async () => {
    const listSwaps = splitListSwaps([swap({ id: "p1", funded: false })]);
    ctxRef.current = ctxWith(listSwaps);

    const { result, rerender } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await waitFor(() =>
      expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["p1"]),
    );

    ctxRef.current = ctxWith(listSwaps, { addresses: null });
    rerender();
    await waitFor(() => expect(result.current.pendingOwnSwaps).toEqual([]));
  });

  it("re-polls own pending listings while any remain", async () => {
    vi.useFakeTimers();
    // Single deduped seller address → one query per fetch, simpler call counts.
    const listSwaps = splitListSwaps([swap({ id: "p1", funded: false })]);
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );

    // Flush the initial fetches without firing the poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["p1"]);

    const pendingCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === false,
    ).length;

    // One poll tick re-queries the funded:false set.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_OWN_SWAPS_POLL_MS);
    });
    const pendingCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === false,
    ).length;
    expect(pendingCallsAfter).toBeGreaterThan(pendingCallsBefore);
  });

  it("auto-refreshes the main feed when a pending listing confirms", async () => {
    vi.useFakeTimers();
    // funded:false query returns the listing on the first poll, then empty (it
    // has confirmed). funded:true (main feed) query is counted to prove it
    // re-fetches on the transition.
    let pendingCalls = 0;
    const listSwaps = vi.fn((params: { funded?: boolean }) => {
      if (params.funded === false) {
        pendingCalls += 1;
        return Promise.resolve(
          listResult(pendingCalls <= 1 ? [swap({ id: "p1", funded: false })] : []),
        );
      }
      return Promise.resolve(listResult([]));
    });
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["p1"]);
    const feedCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === true,
    ).length;

    // Poll: the listing is no longer awaiting → main feed refetches once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_OWN_SWAPS_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.pendingOwnSwaps).toEqual([]);
    const feedCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === true,
    ).length;
    expect(feedCallsAfter).toBeGreaterThan(feedCallsBefore);
  });

  it("does not refresh the main feed when the pending set is unchanged", async () => {
    vi.useFakeTimers();
    // The same listing stays pending across polls — no transition, no refetch.
    const listSwaps = vi.fn((params: { funded?: boolean }) =>
      Promise.resolve(
        params.funded === false
          ? listResult([swap({ id: "p1", funded: false })])
          : listResult([]),
      ),
    );
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    const { result } = renderHook(() =>
      useSwapList({ includePendingOwnSwaps: true }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const feedCallsBefore = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === true,
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_OWN_SWAPS_POLL_MS);
    });
    // Still pending, unchanged → the feed query count is untouched by the poll.
    expect(result.current.pendingOwnSwaps.map((s) => s.id)).toEqual(["p1"]);
    const feedCallsAfter = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === true,
    ).length;
    expect(feedCallsAfter).toBe(feedCallsBefore);
  });

  it("stops polling once no pending listings remain", async () => {
    vi.useFakeTimers();
    const listSwaps = splitListSwaps([]); // nothing pending
    ctxRef.current = ctxWith(listSwaps, {
      addresses: { p2wpkh: "bc1qsame", p2tr: "bc1qsame", publicKey: "02aa" },
    });

    renderHook(() => useSwapList({ includePendingOwnSwaps: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const before = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === false,
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_OWN_SWAPS_POLL_MS * 3);
    });
    const after = listSwaps.mock.calls.filter(
      (c) => c[0]?.funded === false,
    ).length;
    // No poll scheduled when the pending set is empty.
    expect(after).toBe(before);
  });
});
