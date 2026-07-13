// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import {
  balancesCacheKey,
  writeBalancesCache,
} from "../internal/balancesCache.js";
import { useAssets } from "./useAssets.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

// ── helpers ─────────────────────────────────────────────────────────────────

/** A minimal `Response` for the ord API `fetch`. */
function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response;
}
function errRes(status: number): Response {
  return { ok: false, status, statusText: "Error" } as Response;
}

/** A manually-settled promise, for holding a fetch in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The three balance reads the hook calls on the context `client`. */
type LooseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCounterpartyBalances?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getZeldBalances?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getKontorHoldings?: any;
};
function asClient(c: LooseClient): HorizonMarketContextValue["client"] {
  return c as unknown as HorizonMarketContextValue["client"];
}

describe("useAssets", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads counterparty, ZELD, and ordinal assets across both addresses (loading → loaded)", async () => {
    const p2wpkh = "bc1qhappy";
    const p2tr = "bc1phappy";
    const cp = deferred<
      Array<{
        asset: string;
        address: string;
        quantity: bigint;
        quantityNormalized: string;
        divisible: boolean;
      }>
    >();
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(() => cp.promise),
      getZeldBalances: vi.fn(async () => [
        {
          asset: "ZELD",
          address: p2wpkh,
          balance: 5_000n,
          quantityNormalized: "0.00005000",
          divisible: true,
        },
      ]),
      getKontorHoldings: vi.fn(),
    };
    // URL-dispatched ord API: address → inscription-id list, then per-id satpoint.
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/address/")) {
        return url.includes(p2wpkh)
          ? okJson({ inscriptions: ["insc1", "insc2", "insc3"] })
          : okJson({}); // p2tr holds no inscriptions
      }
      if (url.includes("/inscription/insc1")) return okJson({ satpoint: "aaaa:0:0" });
      if (url.includes("/inscription/insc2")) return okJson({ satpoint: "nocolon" }); // no vout → dropped
      if (url.includes("/inscription/insc3")) return okJson({}); // no satpoint → dropped
      throw new Error(`unexpected fetch ${url}`);
    });
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      ordApiBaseUrl: "https://ord.example/",
      client: asClient(client),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useAssets());
    // Fetch is in flight while the counterparty read is unresolved.
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.lastFetchedAt).toBeNull();

    await act(async () => {
      cp.resolve([
        {
          asset: "XCP",
          address: p2wpkh,
          quantity: 100n,
          quantityNormalized: "0.000001",
          divisible: true,
        },
        {
          asset: "RAREPEPE",
          address: p2tr,
          quantity: 3n,
          quantityNormalized: "3",
          divisible: false,
        },
      ]);
      await cp.promise;
    });

    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());
    expect(result.current.isFetching).toBe(false);

    expect(result.current.counterpartyAssets).toHaveLength(2);
    expect(result.current.counterpartyAssets[0]).toMatchObject({
      type: "counterparty",
      assetName: "XCP",
      address: p2wpkh,
      balance: 100n,
      quantityNormalized: "0.000001",
      divisible: true,
    });
    expect(result.current.zeldAssets).toHaveLength(1);
    expect(result.current.zeldAssets[0]).toMatchObject({
      type: "zeld",
      address: p2wpkh,
      balance: 5_000n,
      divisible: true,
    });
    // Only insc1 has a resolvable holding UTXO; insc2/insc3 are dropped.
    expect(result.current.ordinals).toEqual([
      { type: "ordinal", inscriptionId: "insc1", utxoId: "aaaa:0", address: p2wpkh },
    ]);
    expect(result.current.korAssets).toHaveLength(0);
    expect(result.current.kontorNfts).toHaveLength(0);
    // flatten order: counterparty → zeld → kor → kontorNfts → ordinals
    expect(result.current.allAssets.map((a) => a.type)).toEqual([
      "counterparty",
      "counterparty",
      "zeld",
      "ordinal",
    ]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.errors).toEqual({
      counterparty: null,
      zeld: null,
      ordinals: null,
      kontor: null,
    });
    // Not signet → the Kontor read is skipped entirely.
    expect(client.getKontorHoldings).not.toHaveBeenCalled();
  });

  it("reports isEmpty once every source has loaded with no holdings", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    const fetch = vi.fn();
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qempty", p2tr: "bc1pempty", publicKey: "02aa" },
      // ordApiBaseUrl omitted → fetchOrdinals returns [] without touching fetch.
      client: asClient(client),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.allAssets).toEqual([]);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.lastFetchedAt).toEqual(expect.any(Number));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resets to an empty, not-loaded state when no wallet is connected", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(),
      getZeldBalances: vi.fn(),
      getKontorHoldings: vi.fn(),
    };
    ctxRef.current = makeCtx({
      addresses: null,
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    // No async load happens; give the effect a tick to run its reset branch.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.allAssets).toEqual([]);
    expect(result.current.lastFetchedAt).toBeNull();
    expect(result.current.isFetching).toBe(false);
    // loadedOnce stays false → not "empty", just idle.
    expect(result.current.isEmpty).toBe(false);
    expect(client.getCounterpartyBalances).not.toHaveBeenCalled();
  });

  it("records per-source errors on partial failures and keeps successful groups", async () => {
    const p2wpkh = "bc1qpartial";
    const p2tr = "bc1ppartial";
    const client: LooseClient = {
      // Rejects with a non-Error so toError()'s String() branch is exercised.
      getCounterpartyBalances: vi.fn(async () => {
        throw "cp-string-fail";
      }),
      getZeldBalances: vi.fn(async () => [
        {
          asset: "ZELD",
          address: p2wpkh,
          balance: 42n,
          quantityNormalized: "0.00000042",
          divisible: true,
        },
      ]),
      getKontorHoldings: vi.fn(),
    };
    // Ord /address/ returns non-ok → fetchOrdinals throws → ordinals error.
    const fetch = vi.fn(async () => errRes(500));
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      ordApiBaseUrl: "https://ord.example",
      client: asClient(client),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() =>
      expect(result.current.errors.counterparty).not.toBeNull(),
    );

    expect(result.current.errors.counterparty?.message).toBe("cp-string-fail");
    expect(result.current.errors.ordinals).toBeInstanceOf(Error);
    expect(result.current.errors.zeld).toBeNull();
    expect(result.current.errors.kontor).toBeNull();
    // The one succeeding group still surfaces.
    expect(result.current.zeldAssets).toHaveLength(1);
    expect(result.current.counterpartyAssets).toEqual([]);
    expect(result.current.ordinals).toEqual([]);
    expect(result.current.lastFetchedAt).toEqual(expect.any(Number));
    expect(result.current.isEmpty).toBe(false);
  });

  it("handles a single-address wallet and a non-object ord response", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    // Body is `null` (not an object) → extractInscriptionIds returns [].
    const fetch = vi.fn(async () => okJson(null));
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qsingle", p2tr: "", publicKey: "02aa" },
      ordApiBaseUrl: "https://ord.example",
      client: asClient(client),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());
    // Only the P2WPKH address is queried (no P2TR configured).
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.ordinals).toEqual([]);
    expect(result.current.errors.ordinals).toBeNull();
    expect(result.current.isEmpty).toBe(true);
  });

  it("surfaces an ordinals error when a per-inscription lookup fails", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    // The address list resolves, but resolving the inscription's UTXO fails.
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/address/")) return okJson({ inscriptions: ["inscX"] });
      return errRes(500); // /inscription/inscX → non-ok → per-inscription throw
    });
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qinsfail", p2tr: "bc1pinsfail", publicKey: "02aa" },
      ordApiBaseUrl: "https://ord.example",
      client: asClient(client),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.errors.ordinals).not.toBeNull());
    expect(result.current.errors.ordinals?.message).toContain("500");
    expect(result.current.ordinals).toEqual([]);
    // Non-ordinal groups still loaded fine.
    expect(result.current.errors.counterparty).toBeNull();
    expect(result.current.lastFetchedAt).toEqual(expect.any(Number));
  });

  it("includes KOR balance and Kontor NFTs on signet", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(async () => ({
        kor: { amount: "100.5", address: "tb1pkor" },
        nfts: [
          { nftId: "nft1", contractAddress: "myc@100.0", address: "tb1pnft" },
          { nftId: "nft2", contractAddress: "myc@100.0", address: "tb1pnft" },
        ],
      })),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qkontor", p2tr: "bc1pkontor", publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());

    expect(client.getKontorHoldings).toHaveBeenCalledTimes(1);
    expect(result.current.korAssets).toEqual([
      { type: "kor", address: "tb1pkor", amount: "100.5" },
    ]);
    expect(result.current.kontorNfts).toHaveLength(2);
    expect(result.current.kontorNfts[0]).toMatchObject({
      type: "kontor-nft",
      nftId: "nft1",
      contractAddress: "myc@100.0",
      address: "tb1pnft",
    });
    // flatten order: kor precedes kontor NFTs (both precede ordinals; none here).
    expect(result.current.allAssets.map((a) => a.type)).toEqual([
      "kor",
      "kontor-nft",
      "kontor-nft",
    ]);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.errors.kontor).toBeNull();
  });

  it("records a kontor error (and a ZELD error) when those reads reject on signet", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => {
        throw new Error("zeld boom");
      }),
      getKontorHoldings: vi.fn(async () => {
        throw new Error("kontor down");
      }),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qkerr", p2tr: "bc1pkerr", publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.errors.kontor).not.toBeNull());

    expect(result.current.errors.kontor?.message).toBe("kontor down");
    expect(result.current.errors.zeld?.message).toBe("zeld boom");
    expect(result.current.errors.counterparty).toBeNull();
    expect(result.current.errors.ordinals).toBeNull(); // ord not configured → []
    expect(result.current.korAssets).toEqual([]);
    expect(result.current.kontorNfts).toEqual([]);
    // Everything either failed or was empty → loaded but empty.
    expect(result.current.isEmpty).toBe(true);
  });

  it("seeds from a fresh balances-cache entry without hitting the network", async () => {
    const p2wpkh = "bc1qcached";
    const p2tr = "bc1pcached";
    const network = "mainnet";
    const cacheKey = balancesCacheKey(network, [p2wpkh, p2tr]);
    // One of every AssetOption type → exercises every regroup() branch on read.
    const fetchedAt = writeBalancesCache(cacheKey, [
      {
        type: "counterparty",
        assetName: "XCP",
        address: p2wpkh,
        balance: 777n,
        quantityNormalized: "0.00000777",
        divisible: true,
      },
      {
        type: "zeld",
        address: p2wpkh,
        balance: 5n,
        quantityNormalized: "0.00000005",
        divisible: true,
      },
      { type: "kor", address: "tb1pkor", amount: "3" },
      {
        type: "kontor-nft",
        nftId: "n1",
        contractAddress: "c@1.0",
        address: "tb1pnft",
      },
      { type: "ordinal", inscriptionId: "i1", utxoId: "u:0", address: p2tr },
    ]);

    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(),
      getZeldBalances: vi.fn(),
      getKontorHoldings: vi.fn(),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      network,
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());

    expect(result.current.counterpartyAssets).toEqual([
      {
        type: "counterparty",
        assetName: "XCP",
        address: p2wpkh,
        balance: 777n, // revived from the serialized $bigint tag
        quantityNormalized: "0.00000777",
        divisible: true,
      },
    ]);
    expect(result.current.zeldAssets).toHaveLength(1);
    expect(result.current.zeldAssets[0]).toMatchObject({ balance: 5n });
    expect(result.current.korAssets).toHaveLength(1);
    expect(result.current.kontorNfts).toHaveLength(1);
    expect(result.current.ordinals).toHaveLength(1);
    expect(result.current.allAssets).toHaveLength(5);
    expect(result.current.lastFetchedAt).toBe(fetchedAt);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    // Seeded from cache → no network reads.
    expect(client.getCounterpartyBalances).not.toHaveBeenCalled();
    expect(client.getZeldBalances).not.toHaveBeenCalled();
  });

  it("refresh() bypasses the cache and re-fetches", async () => {
    const p2wpkh = "bc1qrefresh2";
    const p2tr = "bc1prefresh2";
    const cp = vi
      .fn()
      .mockResolvedValueOnce([
        {
          asset: "XCP",
          address: p2wpkh,
          quantity: 1n,
          quantityNormalized: "0.00000001",
          divisible: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          asset: "XCP",
          address: p2wpkh,
          quantity: 1n,
          quantityNormalized: "0.00000001",
          divisible: true,
        },
        {
          asset: "PEPE",
          address: p2tr,
          quantity: 2n,
          quantityNormalized: "2",
          divisible: false,
        },
      ]);
    const client: LooseClient = {
      getCounterpartyBalances: cp,
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() =>
      expect(result.current.counterpartyAssets).toHaveLength(1),
    );
    const firstFetchedAt = result.current.lastFetchedAt ?? 0;

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() =>
      expect(result.current.counterpartyAssets).toHaveLength(2),
    );

    // Two network reads → the cache write from the first load was bypassed.
    expect(cp).toHaveBeenCalledTimes(2);
    expect(result.current.lastFetchedAt ?? 0).toBeGreaterThanOrEqual(
      firstFetchedAt,
    );
  });

  it("discards an in-flight fetch when the wallet changes before it settles", async () => {
    const cp = deferred<
      Array<{
        asset: string;
        address: string;
        quantity: bigint;
        quantityNormalized: string;
        divisible: boolean;
      }>
    >();
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(() => cp.promise),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qstale", p2tr: "bc1pstale", publicKey: "02aa" },
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result, rerender } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.isFetching).toBe(true));

    // Disconnect: the effect re-runs, the reset branch bumps the sequence, and
    // the still-pending fetch is now stale.
    ctxRef.current = makeCtx({
      addresses: null,
      client: asClient(client),
      fetch: vi.fn(),
    });
    await act(async () => {
      rerender();
    });
    expect(result.current.isFetching).toBe(false);

    // The stale fetch settles — its sequence no longer matches, so it is dropped.
    await act(async () => {
      cp.resolve([
        {
          asset: "XCP",
          address: "bc1qstale",
          quantity: 9n,
          quantityNormalized: "0.00000009",
          divisible: true,
        },
      ]);
      await cp.promise;
    });

    expect(result.current.counterpartyAssets).toEqual([]);
    expect(result.current.lastFetchedAt).toBeNull();
    expect(result.current.isEmpty).toBe(false);
  });
});
