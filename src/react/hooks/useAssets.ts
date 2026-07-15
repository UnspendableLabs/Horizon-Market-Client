import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
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
  /** True once every group has loaded and none has any holdings. */
  isEmpty: boolean;
  /** Any non-fatal per-group fetch errors (e.g. ZELD >500 UTXOs). */
  errors: {
    counterparty: Error | null;
    zeld: Error | null;
    ordinals: Error | null;
    kontor: Error | null;
  };
  /** Epoch ms of the last successful fetch (cache or network), or null. */
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

type GroupErrors = UseAssetsResult["errors"];

const NO_ERRORS: GroupErrors = {
  counterparty: null,
  zeld: null,
  ordinals: null,
  kontor: null,
};

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
        setLastFetchedAt(null);
        setLoadedOnce(false);
        return;
      }

      const fetchAddresses = [p2wpkh, ...(p2tr ? [p2tr] : [])];
      const cacheKey = balancesCacheKey(network, fetchAddresses);

      // Seed from a fresh cache entry without hitting the network.
      if (!opts.force) {
        const cached = readBalancesCache<AssetOption[]>(cacheKey, ttlMs);
        if (cached) {
          // Same invalidation as the reset branch: an in-flight fetch for a
          // previous wallet must not overwrite this seed when it settles.
          seqRef.current++;
          setIsFetching(false);
          setGroups(regroup(cached.data));
          setErrors(NO_ERRORS);
          setLastFetchedAt(cached.fetchedAt);
          setLoadedOnce(true);
          return;
        }
      }

      const seq = ++seqRef.current;
      setIsFetching(true);

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

      const [cpResult, zeldResult, ordResult, kontorResult] =
        await Promise.allSettled([
          client.getCounterpartyBalances(fetchAddresses),
          client.getZeldBalances(fetchAddresses),
          fetchOrdinals(),
          kontorNetwork === "signet"
            ? client.getKontorHoldings()
            : Promise.resolve({ kor: null, nfts: [] as const }),
        ]);

      if (seq !== seqRef.current) return;

      const next: AssetGroups = {
        counterparty: [],
        zeld: [],
        ordinals: [],
        kor: [],
        kontorNfts: [],
      };

      if (cpResult.status === "fulfilled") {
        next.counterparty = cpResult.value.map((b) => ({
          type: "counterparty" as const,
          assetName: b.asset,
          address: b.address,
          balance: b.quantity,
          quantityNormalized: b.quantityNormalized,
          divisible: b.divisible,
        }));
      } else {
        nextErrors.counterparty = toError(cpResult.reason);
      }

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

      if (ordResult.status === "fulfilled") {
        next.ordinals = ordResult.value;
      } else {
        nextErrors.ordinals = toError(ordResult.reason);
      }

      if (kontorResult.status === "fulfilled") {
        const holdings = kontorResult.value;
        if (holdings.kor) {
          next.kor = [
            {
              type: "kor" as const,
              address: holdings.kor.address,
              amount: holdings.kor.amount,
            },
          ];
        }
        next.kontorNfts = holdings.nfts.map((n) => ({
          type: "kontor-nft" as const,
          nftId: n.nftId,
          contractAddress: n.contractAddress,
          address: n.address,
        }));
      } else {
        nextErrors.kontor = toError(kontorResult.reason);
      }

      const fetchedAt = writeBalancesCache(cacheKey, flatten(next));
      setGroups(next);
      setErrors(nextErrors);
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

  const allAssets = flatten(groups);
  const isEmpty = loadedOnce && allAssets.length === 0;

  return {
    counterpartyAssets: groups.counterparty,
    zeldAssets: groups.zeld,
    ordinals: groups.ordinals,
    korAssets: groups.kor,
    kontorNfts: groups.kontorNfts,
    allAssets,
    isEmpty,
    errors,
    lastFetchedAt,
    isFetching,
    refresh,
  };
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
