/**
 * A small persistent cache for the connected wallet's owned balances.
 *
 * Each connect fans out to several external APIs (Counterparty + ZELD + ord, ×2
 * addresses, + Kontor), so we cache aggressively and only re-fetch on demand.
 *
 * Storage: `localStorage` when available (web — survives reload), else a
 * module-level in-memory `Map` (native / SSR). No new deps.
 *
 * `bigint` balances can't go through `JSON.stringify`, so they are tagged and
 * serialized as `{ $bigint: "<decimal>" }` and revived back to `bigint` on read.
 */

const KEY_PREFIX = "hm:balances:v1";

/** Build the cache key for a network + the set of addresses being queried. */
export function balancesCacheKey(
  network: string,
  addresses: string[],
): string {
  const sorted = [...new Set(addresses.filter(Boolean))].sort();
  return `${KEY_PREFIX}:${network}:${sorted.join(",")}`;
}

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

interface BigIntTag {
  $bigint: string;
}

function isBigIntTag(v: unknown): v is BigIntTag {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BigIntTag).$bigint === "string"
  );
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { $bigint: value.toString() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  return isBigIntTag(value) ? BigInt(value.$bigint) : value;
}

// In-memory fallback (native / SSR) — survives within a process, not reloads.
const memoryStore = new Map<string, string>();

interface KeyValueStore {
  get: (k: string) => string | null;
  set: (k: string, v: string) => void;
  remove: (k: string) => void;
}

const memoryKeyValueStore: KeyValueStore = {
  get: (k) => memoryStore.get(k) ?? null,
  set: (k, v) => {
    memoryStore.set(k, v);
  },
  remove: (k) => {
    memoryStore.delete(k);
  },
};

// Detect a *functional* localStorage. Node 20+ exposes a `localStorage` object
// that throws on access unless enabled, and some test envs stub it partially —
// so probe with a real round-trip rather than a truthiness check.
let cachedStore: KeyValueStore | null = null;

function getStore(): KeyValueStore {
  if (cachedStore) return cachedStore;
  try {
    const ls =
      typeof localStorage !== "undefined" ? localStorage : undefined;
    if (
      ls &&
      typeof ls.getItem === "function" &&
      typeof ls.setItem === "function" &&
      typeof ls.removeItem === "function"
    ) {
      const probe = "hm:balances:probe";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      cachedStore = {
        get: (k) => ls.getItem(k),
        set: (k, v) => ls.setItem(k, v),
        remove: (k) => ls.removeItem(k),
      };
      return cachedStore;
    }
  } catch {
    // localStorage unavailable (private mode, disabled, Node) — fall through.
  }
  cachedStore = memoryKeyValueStore;
  return cachedStore;
}

/**
 * Read the cache entry for `key`, but only if it is younger than `ttlMs`.
 * Returns `{ fetchedAt, data }` on a fresh hit, else `null` (miss / expired /
 * corrupt). Bigints in `data` are revived from their serialized form.
 */
export function readBalancesCache<T>(
  key: string,
  ttlMs: number,
): CacheEntry<T> | null {
  const raw = getStore().get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw, reviver) as CacheEntry<T>;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== "number" ||
      !("data" in parsed)
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt >= ttlMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write `data` to the cache under `key` with `fetchedAt`. Returns `fetchedAt`. */
export function writeBalancesCache<T>(
  key: string,
  data: T,
  fetchedAt: number = Date.now(),
): number {
  const entry: CacheEntry<T> = { fetchedAt, data };
  try {
    getStore().set(key, JSON.stringify(entry, replacer));
  } catch {
    // Storage full / unavailable — caching is best-effort.
  }
  return fetchedAt;
}
