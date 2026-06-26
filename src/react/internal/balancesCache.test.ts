import { afterEach, describe, expect, it, vi } from "vitest";
import {
  balancesCacheKey,
  readBalancesCache,
  writeBalancesCache,
} from "./balancesCache.js";

// Whichever store the runtime resolves (localStorage when functional, else the
// in-memory Map), these exercise the serialize/revive + TTL logic. A dedicated
// block below forces the in-memory fallback to verify it independently.

afterEach(() => {
  vi.useRealTimers();
});

describe("balancesCacheKey", () => {
  it("is stable regardless of address order and dedupes", () => {
    expect(balancesCacheKey("mainnet", ["b", "a", "b"])).toBe(
      balancesCacheKey("mainnet", ["a", "b"]),
    );
  });

  it("varies by network", () => {
    expect(balancesCacheKey("mainnet", ["a"])).not.toBe(
      balancesCacheKey("testnet", ["a"]),
    );
  });
});

interface Holding {
  asset: string;
  balance: bigint;
}

describe("readBalancesCache / writeBalancesCache", () => {
  it("round-trips bigint balances", () => {
    const key = balancesCacheKey("mainnet", ["bigint-rt"]);
    const data: Holding[] = [
      { asset: "XCP", balance: 1250000000n },
      { asset: "BIG", balance: BigInt(Number.MAX_SAFE_INTEGER) + 10n },
    ];
    writeBalancesCache(key, data);
    const entry = readBalancesCache<Holding[]>(key, 60_000);
    expect(entry).not.toBeNull();
    expect(entry?.data[0].balance).toBe(1250000000n);
    expect(typeof entry?.data[0].balance).toBe("bigint");
    expect(entry?.data[1].balance).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 10n);
  });

  it("returns null after the TTL expires", () => {
    vi.useFakeTimers();
    const key = balancesCacheKey("mainnet", ["ttl-expiry"]);
    const fetchedAt = Date.now();
    writeBalancesCache(key, [{ asset: "XCP", balance: 1n }], fetchedAt);

    // Within TTL → hit.
    expect(readBalancesCache(key, 1000)).not.toBeNull();

    // Advance past the TTL → miss.
    vi.setSystemTime(fetchedAt + 1001);
    expect(readBalancesCache(key, 1000)).toBeNull();
  });

  it("returns the fetchedAt timestamp", () => {
    const key = balancesCacheKey("mainnet", ["timestamp"]);
    const at = writeBalancesCache(key, [], 1_700_000_000_000);
    expect(at).toBe(1_700_000_000_000);
    const entry = readBalancesCache(key, 10 ** 12);
    expect(entry?.fetchedAt).toBe(1_700_000_000_000);
  });

  it("returns null for a missing key", () => {
    expect(readBalancesCache("hm:balances:v1:nope", 60_000)).toBeNull();
  });
});

describe("in-memory fallback (localStorage throws)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("round-trips bigints via the memory Map when localStorage is unusable", async () => {
    // A localStorage whose probe round-trip throws (private mode / disabled /
    // partial stub) must transparently fall back to the in-memory store.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("localStorage disabled");
      },
      setItem: () => {
        throw new Error("localStorage disabled");
      },
      removeItem: () => {
        throw new Error("localStorage disabled");
      },
    });
    // Fresh import so the module-level `cachedStore` re-resolves under the stub.
    vi.resetModules();
    const cache = await import("./balancesCache.js");

    const key = cache.balancesCacheKey("mainnet", ["mem-fallback"]);
    cache.writeBalancesCache(key, [{ asset: "XCP", balance: 1250000000n }]);
    const entry = cache.readBalancesCache<{ asset: string; balance: bigint }[]>(
      key,
      60_000,
    );
    expect(entry).not.toBeNull();
    expect(entry?.data[0].balance).toBe(1250000000n);
    expect(typeof entry?.data[0].balance).toBe("bigint");
  });
});
