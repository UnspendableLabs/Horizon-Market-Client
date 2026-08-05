// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import {
  balancesCacheKey,
  readBalancesCache,
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
    // Loaded, and every group is empty — but two of them are empty because the
    // read FAILED, so this wallet is not known to hold nothing. `isEmpty` drives
    // empty states ("No assets to sell"), which must not be shown here.
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.sources.kontor).toEqual({
      status: "error",
      error: result.current.errors.kontor,
    });
    expect(result.current.sources.counterparty).toEqual({ status: "ok" });
    // No ord endpoint in this context: never read, so its empty list is not
    // evidence of anything — and it is NOT reported as a failure either.
    expect(result.current.sources.ordinals.status).toBe("unread");
    expect(result.current.errors.ordinals).toBeNull();
  });

  it("surfaces an unavailable kontor read as an error, not as an empty wallet", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      // The real client RESOLVES (never throws) when it can't read at all, so
      // without the `unavailable` tag this is indistinguishable from "holds
      // nothing" — which is exactly what used to reach the UI.
      getKontorHoldings: vi.fn(async () => ({
        kor: null,
        nfts: [],
        unavailable: "wallet-key" as const,
      })),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qkna", p2tr: "bc1pkna", publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.errors.kontor).not.toBeNull());

    expect(result.current.errors.kontor?.message).toMatch(/Taproot public key/);
    expect(result.current.kontorNfts).toEqual([]);
    expect(result.current.errors.counterparty).toBeNull();
  });

  it("caches the sources that answered and names the one that failed", async () => {
    const p2wpkh = "bc1qnocache";
    const p2tr = "bc1pnocache";
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => [
        {
          asset: "PEPECASH",
          address: p2wpkh,
          quantity: 100n,
          quantityNormalized: "100",
          divisible: false,
        },
      ]),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(async () => {
        throw new Error("kontor down");
      }),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.errors.kontor).not.toBeNull());

    // Caching Kontor's absence would make the NEXT mount seed silently (the
    // snapshot carries no errors), replaying a wrong "you hold nothing" for the
    // whole TTL. Dropping the whole snapshot would instead re-fetch the three
    // sources that DID answer on every mount until Kontor recovers.
    const entry = readBalancesCache<{ assets: unknown[]; stale: string[] }>(
      balancesCacheKey("testnet", [p2wpkh, p2tr]),
      3_600_000,
    );
    expect(entry?.data.stale).toEqual(["kontor"]);
    expect(entry?.data.assets).toEqual([
      {
        type: "counterparty",
        assetName: "PEPECASH",
        assetLongname: null,
        address: p2wpkh,
        balance: 100n,
        quantityNormalized: "100",
        divisible: false,
      },
    ]);
  });

  it("re-fetches only the stale source when seeding a partial snapshot", async () => {
    const p2wpkh = "bc1qpartial";
    const p2tr = "bc1ppartial";
    const cacheKey = balancesCacheKey("testnet", [p2wpkh, p2tr]);
    const fetchedAt = writeBalancesCache(cacheKey, {
      assets: [
        {
          type: "counterparty",
          assetName: "XCP",
          assetLongname: null,
          address: p2wpkh,
          balance: 500n,
          quantityNormalized: "0.000005",
          divisible: true,
        },
      ],
      stale: ["kontor"],
    });

    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(),
      getZeldBalances: vi.fn(),
      getKontorHoldings: vi.fn(async () => ({
        kor: { address: "tb1pkor", amount: "12" },
        nfts: [],
        unavailable: null,
      })),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.korAssets).toHaveLength(1));

    // Only the source that failed last time goes back to the network...
    expect(client.getKontorHoldings).toHaveBeenCalledTimes(1);
    expect(client.getCounterpartyBalances).not.toHaveBeenCalled();
    expect(client.getZeldBalances).not.toHaveBeenCalled();
    // ...and the cached holdings survive the top-up.
    expect(result.current.counterpartyAssets).toHaveLength(1);
    expect(result.current.errors.kontor).toBeNull();

    const entry = readBalancesCache<{ assets: unknown[]; stale: string[] }>(
      cacheKey,
      3_600_000,
    );
    expect(entry?.data.stale).toEqual([]);
    expect(entry?.data.assets).toHaveLength(2);
    // The topped-up entry keeps the ORIGINAL timestamp: a partial refresh must
    // not extend the cached part's TTL (nor claim the data is newer than it is).
    expect(entry?.fetchedAt).toBe(fetchedAt);
    expect(result.current.lastFetchedAt).toBe(fetchedAt);
  });

  it("keeps a source `loading` until its own read settles, seeded or not", async () => {
    const p2wpkh = "bc1qinflight";
    const p2tr = "bc1pinflight";
    const cacheKey = balancesCacheKey("testnet", [p2wpkh, p2tr]);
    writeBalancesCache(cacheKey, { assets: [], stale: ["kontor"] });

    const gate = deferred<{ kor: null; nfts: []; unavailable: null }>();
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(),
      getZeldBalances: vi.fn(),
      getKontorHoldings: vi.fn(() => gate.promise),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh, p2tr, publicKey: "02aa" },
      network: "testnet",
      kontorNetwork: "signet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());

    // Seeding paints immediately (`lastFetchedAt` is set, so nothing renders a
    // spinner), and the Kontor group is empty — but its read is still in the
    // air. Reporting it as `ok` here would flash "No Kontor holdings yet." for
    // the length of the request: the very claim this hook must not make.
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());
    expect(result.current.sources.kontor).toEqual({ status: "loading" });
    // The sources that came from the cache already have their answer.
    expect(result.current.sources.counterparty).toEqual({ status: "ok" });

    await act(async () => {
      gate.resolve({ kor: null, nfts: [], unavailable: null });
      await gate.promise;
    });
    expect(result.current.sources.kontor).toEqual({ status: "ok" });
  });

  it("reports a source this app never reads as `unread`, not as empty", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    // No `ordApiBaseUrl` and Kontor off this network: neither source is ever
    // asked, so neither empty list is evidence the wallet holds none of them.
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qunread", p2tr: "bc1punread", publicKey: "02aa" },
      network: "mainnet",
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());

    expect(result.current.sources.ordinals.status).toBe("unread");
    expect(result.current.sources.kontor.status).toBe("unread");
    // Not a failure — it must stay out of `errors`, which blanks the headline
    // KOR/XCP/ZELD amounts and feeds the sell form's error list.
    expect(result.current.errors).toEqual({
      counterparty: null,
      zeld: null,
      ordinals: null,
      kontor: null,
    });
    expect(client.getKontorHoldings).not.toHaveBeenCalled();
    // Counterparty and ZELD were read and really are empty.
    expect(result.current.sources.counterparty).toEqual({ status: "ok" });
    expect(result.current.sources.zeld).toEqual({ status: "ok" });
    expect(result.current.isEmpty).toBe(true);
  });

  it("reports ZELD as `unread` when no ZeldHash API resolves", async () => {
    const client: LooseClient = {
      getCounterpartyBalances: vi.fn(async () => []),
      // The real client returns [] without fetching when zeldApiBaseUrl is
      // unset — an empty list that is NOT evidence of an empty ZELD balance.
      getZeldBalances: vi.fn(async () => []),
      getKontorHoldings: vi.fn(),
    };
    ctxRef.current = makeCtx({
      addresses: { p2wpkh: "bc1qnozeld", p2tr: "bc1pnozeld", publicKey: "02aa" },
      network: "testnet",
      zeldApiBaseUrl: undefined,
      client: asClient(client),
      fetch: vi.fn(),
    });

    const { result } = renderHook(() => useAssets());
    await waitFor(() => expect(result.current.lastFetchedAt).not.toBeNull());

    expect(result.current.sources.zeld.status).toBe("unread");
    expect(result.current.errors.zeld).toBeNull();
  });

  it("seeds from a fresh balances-cache entry without hitting the network", async () => {
    const p2wpkh = "bc1qcached";
    const p2tr = "bc1pcached";
    const network = "mainnet";
    const cacheKey = balancesCacheKey(network, [p2wpkh, p2tr]);
    // One of every AssetOption type → exercises every regroup() branch on read.
    // `stale: []` — every source answered, so nothing needs re-fetching.
    const fetchedAt = writeBalancesCache(cacheKey, {
      assets: [
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
      ],
      stale: [],
    });

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
