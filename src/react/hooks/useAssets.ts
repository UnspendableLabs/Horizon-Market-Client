import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  CounterpartyBalance,
  KontorUnavailableReason,
  ZeldBalance,
} from "../../client.js";
import {
  balancesCacheKey,
  readBalancesCache,
  writeBalancesCache,
} from "../internal/balancesCache.js";

/**
 * An asset the connected wallet actually owns, scoped to the holding `address`
 * (the same asset can sit on both the P2WPKH and P2TR address → distinct
 * options). Fungibles carry their balance; ordinals/NFTs are 1-of-1.
 */
export type AssetOption =
  | {
      type: "counterparty";
      assetName: string;
      /**
       * Subasset long name (e.g. "PEPENARDO.CARD"), or `null` when the asset has
       * none. `assetName` is the on-chain identifier (a numeric `A…` name for
       * subassets); prefer `assetLongname ?? assetName` for display. Optional so
       * hand-built fixtures need not set it.
       */
      assetLongname?: string | null;
      address: string;
      balance: bigint;
      quantityNormalized: string;
      divisible: boolean;
    }
  | {
      type: "zeld";
      address: string;
      balance: bigint;
      quantityNormalized: string;
      divisible: true;
    }
  | { type: "ordinal"; inscriptionId: string; utxoId: string; address: string }
  | { type: "kor"; address: string; amount: string }
  | {
      type: "kontor-nft";
      nftId: string;
      contractAddress: string;
      address: string;
    };

interface AssetGroups {
  counterparty: AssetOption[];
  zeld: AssetOption[];
  ordinals: AssetOption[];
  kor: AssetOption[];
  kontorNfts: AssetOption[];
}

const EMPTY_GROUPS: AssetGroups = {
  counterparty: [],
  zeld: [],
  ordinals: [],
  kor: [],
  kontorNfts: [],
};

/** The independent reads behind the groups — one error slot, one cache slot each. */
export type SourceKey = "counterparty" | "zeld" | "ordinals" | "kontor";

/**
 * Why a source contributed no holdings. An empty list on its own says nothing:
 * only `ok` licenses a renderer to claim the wallet holds none of that kind.
 *
 * - `loading` — the read is in flight (or hasn't started).
 * - `ok` — the read succeeded; an empty group really is an empty group.
 * - `error` — the read failed. Also surfaced in {@link UseAssetsResult.errors}.
 * - `unread` — this app never asks for that source (no `ordApiBaseUrl`, Kontor
 *   off this network). NOT a failure — nothing went wrong and there is nothing
 *   to retry — so it stays out of `errors`, which drives the headline amounts
 *   and the sell form's error list.
 */
export type SourceState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; error: Error }
  | { status: "unread"; reason: string };

export interface UseAssetsResult {
  /** XCP + Counterparty assets the wallet holds (mainnet). */
  counterpartyAssets: AssetOption[];
  /** ZELD holdings (its own protocol, mainnet only). */
  zeldAssets: AssetOption[];
  /** Ordinal inscriptions across both addresses. */
  ordinals: AssetOption[];
  /** KOR token balance (signet Kontor). */
  korAssets: AssetOption[];
  /** Owned Kontor NFTs (signet, requires a configured contract). */
  kontorNfts: AssetOption[];
  /** All owned options, flattened (Counterparty → ZELD → KOR → NFTs → Ordinals). */
  allAssets: AssetOption[];
  /**
   * True once every source that was read has answered, and none has any
   * holdings. A FAILED read yields an empty list too, so it doesn't count:
   * "empty + an error" is "we couldn't look", not an empty wallet, and a
   * consumer rendering an empty state off this must not be handed the former.
   * An `unread` source doesn't block it — Kontor off mainnet is not a gap in
   * what we know, so it must not keep a genuinely empty wallet from saying so.
   */
  isEmpty: boolean;
  /** Any non-fatal per-group fetch errors (e.g. ZELD >500 UTXOs). */
  errors: {
    counterparty: Error | null;
    zeld: Error | null;
    ordinals: Error | null;
    kontor: Error | null;
  };
  /**
   * Per-source read state — the full picture behind an empty group, of which
   * {@link UseAssetsResult.errors} is only the "it failed" slice. A renderer
   * showing "you hold no X" must check this first: the same empty list also
   * means "still loading" and "this app never reads X".
   */
  sources: Record<SourceKey, SourceState>;
  /**
   * Epoch ms of the snapshot currently in the groups — the network read, or the
   * cache entry it was seeded from (a partial refresh keeps the seeded
   * timestamp, so this never claims the data is newer than it is). Null before
   * the first load.
   */
  lastFetchedAt: number | null;
  /** True while a fetch (initial or refresh) is in flight. */
  isFetching: boolean;
  /** Re-fetch all sources, bypassing the cache, and update the timestamp. */
  refresh: () => void;
}

/**
 * The ord server's `/address/{addr}` returns an object (not an array):
 * `{ outputs, inscriptions, sat_balance, runes_balances }`, where
 * `inscriptions` is a flat list of inscription-id strings. It does NOT carry
 * the holding UTXO — that's resolved per inscription via `/inscription/{id}`.
 */
function extractInscriptionIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const { inscriptions } = raw as { inscriptions?: unknown };
  if (!Array.isArray(inscriptions)) return [];
  return inscriptions.filter((x): x is string => typeof x === "string");
}

/** A `satpoint` is `txid:vout:offset`; the holding UTXO id is `txid:vout`. */
function satpointToUtxoId(satpoint: unknown): string | null {
  if (typeof satpoint !== "string") return null;
  const lastColon = satpoint.lastIndexOf(":");
  if (lastColon <= 0) return null;
  return satpoint.slice(0, lastColon);
}

function regroup(all: AssetOption[]): AssetGroups {
  const groups: AssetGroups = {
    counterparty: [],
    zeld: [],
    ordinals: [],
    kor: [],
    kontorNfts: [],
  };
  for (const a of all) {
    if (a.type === "counterparty") groups.counterparty.push(a);
    else if (a.type === "zeld") groups.zeld.push(a);
    else if (a.type === "ordinal") groups.ordinals.push(a);
    else if (a.type === "kor") groups.kor.push(a);
    else if (a.type === "kontor-nft") groups.kontorNfts.push(a);
  }
  return groups;
}

function flatten(groups: AssetGroups): AssetOption[] {
  return [
    ...groups.counterparty,
    ...groups.zeld,
    ...groups.kor,
    ...groups.kontorNfts,
    ...groups.ordinals,
  ];
}

/**
 * User-facing wording for each {@link KontorUnavailableReason}. Says what went
 * wrong and, where the user can act, what to do — these render in the wallet's
 * Kontor tab, so "unavailable" alone would be as unhelpful as the silent empty
 * list it replaces.
 */
const KONTOR_UNAVAILABLE_MESSAGE: Record<KontorUnavailableReason, string> = {
  runtime:
    "Kontor could not start in this environment, so your KOR and NFTs could not be read.",
  network:
    "Kontor is only available on signet, and this client is configured for another network.",
  "wallet-key":
    "This wallet did not expose a Taproot public key, so your Kontor holdings could not be looked up. Reconnecting the wallet — or using one that reports a Taproot address — should fix it.",
};

/**
 * Wording for a source this app simply never reads — the counterpart of
 * {@link KONTOR_UNAVAILABLE_MESSAGE}, for the case where nothing failed. Kontor
 * reuses its `network` line, which already says exactly this.
 */
const ORDINALS_UNREAD_MESSAGE =
  "This app isn't configured to read ordinals, so your inscriptions weren't looked up.";

type GroupErrors = UseAssetsResult["errors"];

const NO_ERRORS: GroupErrors = {
  counterparty: null,
  zeld: null,
  ordinals: null,
  kontor: null,
};

const SOURCE_KEYS: SourceKey[] = ["counterparty", "zeld", "ordinals", "kontor"];

/**
 * What we persist per wallet: the holdings of the sources that answered, plus
 * the names of those that did NOT.
 *
 * Caching a failed source's absence would replay a wrong "you hold nothing" for
 * the rest of the TTL (the snapshot carries no errors); dropping the whole
 * snapshot instead would make one flaky source — the ord API, typically — cost a
 * full re-fetch of the other three on every mount for as long as it stays down.
 * So we cache what we know and re-fetch only what we don't.
 */
interface CachedBalances {
  assets: AssetOption[];
  stale: SourceKey[];
}

/** Cached snapshot for `key`, or null on a miss / expiry / unusable payload. */
function readSnapshot(
  key: string,
  ttlMs: number,
): { groups: AssetGroups; stale: SourceKey[]; fetchedAt: number } | null {
  const cached = readBalancesCache<CachedBalances>(key, ttlMs);
  if (!cached || !Array.isArray(cached.data?.assets)) return null;
  const raw = cached.data.stale;
  return {
    groups: regroup(cached.data.assets),
    // An unreadable `stale` list means we can't tell which sources are covered
    // — paint what's there, but re-fetch everything.
    stale: Array.isArray(raw)
      ? SOURCE_KEYS.filter((k) => raw.includes(k))
      : SOURCE_KEYS,
    fetchedAt: cached.fetchedAt,
  };
}

export function useAssets(): UseAssetsResult {
  const {
    client,
    addresses,
    network,
    kontorNetwork,
    ordApiBaseUrl,
    fetch,
    balancesCacheTtlMs,
    balancesRefreshKey,
  } = useHorizonMarket();

  const [groups, setGroups] = useState<AssetGroups>(EMPTY_GROUPS);
  const [errors, setErrors] = useState<GroupErrors>(NO_ERRORS);
  // Which sources have a read in flight. Starts as "all of them": before the
  // first fetch settles, every group is empty for want of an answer, and a
  // renderer must not read that as "this wallet holds nothing".
  const [loadingSources, setLoadingSources] = useState<SourceKey[]>(SOURCE_KEYS);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const ttlMs = balancesCacheTtlMs ?? 3_600_000;
  const seqRef = useRef(0);

  const p2wpkh = addresses?.p2wpkh;
  const p2tr = addresses?.p2tr;

  const fetchAll = useCallback(
    async (opts: { force: boolean }) => {
      if (!client || !p2wpkh) {
        // Invalidate any in-flight fetch: it belongs to a previous wallet and
        // would clobber this reset when it settles.
        seqRef.current++;
        setIsFetching(false);
        setGroups(EMPTY_GROUPS);
        setErrors(NO_ERRORS);
        // Back to knowing nothing about any source, same as before the first fetch.
        setLoadingSources(SOURCE_KEYS);
        setLastFetchedAt(null);
        setLoadedOnce(false);
        return;
      }

      const fetchAddresses = [p2wpkh, ...(p2tr ? [p2tr] : [])];
      const cacheKey = balancesCacheKey(network, fetchAddresses);

      // Seed from a fresh cache entry. A complete snapshot skips the network
      // entirely; a partial one (some source failed when it was written) is
      // painted immediately and tops itself up by re-fetching only what's stale.
      let seeded: AssetGroups | null = null;
      let seededAt: number | null = null;
      let toFetch = SOURCE_KEYS;
      if (!opts.force) {
        const snapshot = readSnapshot(cacheKey, ttlMs);
        if (snapshot) {
          // Same invalidation as the reset branch: an in-flight fetch for a
          // previous wallet must not overwrite this seed when it settles.
          seqRef.current++;
          setGroups(snapshot.groups);
          setErrors(NO_ERRORS);
          setLastFetchedAt(snapshot.fetchedAt);
          setLoadedOnce(true);
          if (snapshot.stale.length === 0) {
            setIsFetching(false);
            setLoadingSources([]);
            return;
          }
          seeded = snapshot.groups;
          seededAt = snapshot.fetchedAt;
          toFetch = snapshot.stale;
        }
      }

      const seq = ++seqRef.current;
      setIsFetching(true);
      // Only the sources actually going to the network are "loading" — the ones
      // seeded from cache already have their answer, so their tab can speak.
      setLoadingSources(toFetch);

      const nextErrors: GroupErrors = {
        counterparty: null,
        zeld: null,
        ordinals: null,
        kontor: null,
      };

      const ordRoot = ordApiBaseUrl?.replace(/\/$/, "");
      const fetchOrdinals = async (): Promise<AssetOption[]> => {
        if (!ordRoot) return [];
        const lists = await Promise.all(
          fetchAddresses.map(async (addr) => {
            const res = await fetch(
              `${ordRoot}/address/${encodeURIComponent(addr)}`,
              { headers: { Accept: "application/json" } },
            );
            if (!res.ok)
              throw new Error(
                `Ord API returned ${res.status}: ${res.statusText}`,
              );
            const ids = extractInscriptionIds((await res.json()) as unknown);
            // The address response lists inscription ids but not their UTXOs,
            // so resolve each one's holding outpoint via /inscription/{id}.
            const resolved = await Promise.all(
              ids.map(async (id): Promise<AssetOption | null> => {
                const insRes = await fetch(
                  `${ordRoot}/inscription/${encodeURIComponent(id)}`,
                  { headers: { Accept: "application/json" } },
                );
                if (!insRes.ok)
                  throw new Error(
                    `Ord API returned ${insRes.status}: ${insRes.statusText}`,
                  );
                const body = (await insRes.json()) as { satpoint?: unknown };
                const utxoId = satpointToUtxoId(body.satpoint);
                if (!utxoId) return null;
                return {
                  type: "ordinal",
                  inscriptionId: id,
                  utxoId,
                  address: addr,
                };
              }),
            );
            return resolved.filter((x): x is AssetOption => x !== null);
          }),
        );
        return lists.flat();
      };

      // Only the stale sources are hit on a partial refresh; the rest keep the
      // values they were seeded with. The empty placeholders are never read —
      // each source's result is consumed only when it was actually wanted.
      const wanted = (s: SourceKey) => toFetch.includes(s);

      const [cpResult, zeldResult, ordResult, kontorResult] =
        await Promise.allSettled([
          wanted("counterparty")
            ? client.getCounterpartyBalances(fetchAddresses)
            : Promise.resolve<CounterpartyBalance[]>([]),
          wanted("zeld")
            ? client.getZeldBalances(fetchAddresses)
            : Promise.resolve<ZeldBalance[]>([]),
          wanted("ordinals")
            ? fetchOrdinals()
            : Promise.resolve<AssetOption[]>([]),
          wanted("kontor") && kontorNetwork === "signet"
            ? client.getKontorHoldings()
            : // Kontor isn't configured for this network at all — empty is the
              // truth here, not a failure, so `unavailable` stays null.
              Promise.resolve({
                kor: null,
                nfts: [] as const,
                unavailable: null,
              }),
        ]);

      if (seq !== seqRef.current) return;

      // Start from what was seeded so a skipped source keeps its cached
      // holdings; every fetched source overwrites its own groups below.
      const next: AssetGroups = seeded
        ? { ...seeded }
        : {
            counterparty: [],
            zeld: [],
            ordinals: [],
            kor: [],
            kontorNfts: [],
          };

      if (wanted("counterparty")) {
        if (cpResult.status === "fulfilled") {
          next.counterparty = cpResult.value.map((b) => ({
            type: "counterparty" as const,
            assetName: b.asset,
            assetLongname: b.assetLongname ?? null,
            address: b.address,
            balance: b.quantity,
            quantityNormalized: b.quantityNormalized,
            divisible: b.divisible,
          }));
        } else {
          nextErrors.counterparty = toError(cpResult.reason);
        }
      }

      if (wanted("zeld")) {
        if (zeldResult.status === "fulfilled") {
          next.zeld = zeldResult.value.map((b) => ({
            type: "zeld" as const,
            address: b.address,
            balance: b.balance,
            quantityNormalized: b.quantityNormalized,
            divisible: true as const,
          }));
        } else {
          nextErrors.zeld = toError(zeldResult.reason);
        }
      }

      if (wanted("ordinals")) {
        if (ordResult.status === "fulfilled") {
          next.ordinals = ordResult.value;
        } else {
          nextErrors.ordinals = toError(ordResult.reason);
        }
      }

      if (wanted("kontor")) {
        if (kontorResult.status === "fulfilled") {
          const holdings = kontorResult.value;
          // `getKontorHoldings` degrades to EMPTY holdings (never throws) when
          // it can't read at all, so a fulfilled result is not proof the wallet
          // holds nothing. Surface the reason as an error, otherwise every
          // consumer renders a confident "no Kontor holdings" for what is really
          // "we couldn't look".
          if (holdings.unavailable) {
            nextErrors.kontor = new Error(
              KONTOR_UNAVAILABLE_MESSAGE[holdings.unavailable],
            );
          }
          // Kontor owns two groups — both are replaced together, so a re-read
          // that now finds nothing clears a stale seeded value.
          next.kor = holdings.kor
            ? [
                {
                  type: "kor" as const,
                  address: holdings.kor.address,
                  amount: holdings.kor.amount,
                },
              ]
            : [];
          next.kontorNfts = holdings.nfts.map((n) => ({
            type: "kontor-nft" as const,
            nftId: n.nftId,
            contractAddress: n.contractAddress,
            address: n.address,
          }));
        } else {
          nextErrors.kontor = toError(kontorResult.reason);
        }
      }

      // Cache what answered, and name what didn't so the next mount re-fetches
      // exactly those sources instead of replaying a silent, wrong "you hold
      // nothing" for the rest of the TTL. A failed source contributed no
      // holdings, so `flatten(next)` already excludes it.
      //
      // Keep the seeded timestamp when this was only a top-up: re-stamping it
      // would let a source that keeps failing extend the *other* sources' TTL
      // indefinitely, and `lastFetchedAt` would claim the data is newer than it
      // is. Expiring on the original timestamp forces a full re-read instead.
      const stale = SOURCE_KEYS.filter((k) => nextErrors[k] !== null);
      const fetchedAt = writeBalancesCache<CachedBalances>(
        cacheKey,
        { assets: flatten(next), stale },
        seededAt ?? undefined,
      );
      setGroups(next);
      setErrors(nextErrors);
      setLoadingSources([]);
      setLastFetchedAt(fetchedAt);
      setLoadedOnce(true);
      setIsFetching(false);
    },
    [client, p2wpkh, p2tr, network, kontorNetwork, ordApiBaseUrl, fetch, ttlMs],
  );

  // Fetch (or seed from cache) when the connected wallet changes.
  useEffect(() => {
    void fetchAll({ force: false });
  }, [fetchAll]);

  // Force-refresh (bypassing the cache) when the shared balances-refresh signal is
  // bumped — e.g. after a buy settles. Only fires on an actual key change, not on
  // mount or when `fetchAll` alone changes (the effect above already handles those).
  const prevRefreshKeyRef = useRef(balancesRefreshKey);
  useEffect(() => {
    if (prevRefreshKeyRef.current === balancesRefreshKey) return;
    prevRefreshKeyRef.current = balancesRefreshKey;
    void fetchAll({ force: true });
  }, [balancesRefreshKey, fetchAll]);

  const refresh = useCallback(() => {
    void fetchAll({ force: true });
  }, [fetchAll]);

  // Why each source's group is empty, in one place. `unread` is decided from
  // configuration alone (not from the fetch), so it also covers a group seeded
  // from a cache entry written before the host dropped that endpoint.
  const sources = useMemo<Record<SourceKey, SourceState>>(() => {
    const stateOf = (k: SourceKey): SourceState => {
      if (k === "ordinals" && !ordApiBaseUrl) {
        return { status: "unread", reason: ORDINALS_UNREAD_MESSAGE };
      }
      if (k === "kontor" && kontorNetwork !== "signet") {
        return { status: "unread", reason: KONTOR_UNAVAILABLE_MESSAGE.network };
      }
      const error = errors[k];
      if (error) return { status: "error", error };
      if (loadingSources.includes(k)) return { status: "loading" };
      return { status: "ok" };
    };
    return {
      counterparty: stateOf("counterparty"),
      zeld: stateOf("zeld"),
      ordinals: stateOf("ordinals"),
      kontor: stateOf("kontor"),
    };
  }, [errors, loadingSources, ordApiBaseUrl, kontorNetwork]);

  const allAssets = flatten(groups);
  // A failed source contributes no holdings, so an all-empty result with an
  // error in it is "we couldn't look" — not an empty wallet. Callers render an
  // empty state off this, so it must never conflate the two.
  const anyFailed = SOURCE_KEYS.some((k) => errors[k] !== null);
  const isEmpty = loadedOnce && !anyFailed && allAssets.length === 0;

  return {
    counterpartyAssets: groups.counterparty,
    zeldAssets: groups.zeld,
    ordinals: groups.ordinals,
    korAssets: groups.kor,
    kontorNfts: groups.kontorNfts,
    allAssets,
    isEmpty,
    errors,
    sources,
    lastFetchedAt,
    isFetching,
    refresh,
  };
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
