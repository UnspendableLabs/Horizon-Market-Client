import { describe, it, expect, vi } from "vitest";
import {
  getZeldBalance,
  ZeldTooManyUtxosError,
  ZELD_SATOSHI_DIVISOR,
} from "./zeld.js";
import { makeFetch } from "../test-utils.js";

const BASE = "https://api.zeldhash.com";
const ADDR = "bc1qzeld";

describe("getZeldBalance", () => {
  it("sums per-UTXO balances into a single base-unit total", async () => {
    const fetchFn = makeFetch(200, [
      { balance: 100_000_000, txid: "a".repeat(64), vout: 0 },
      { balance: 50_000_000, txid: "b".repeat(64), vout: 1 },
    ]);
    const result = await getZeldBalance(fetchFn, BASE, ADDR);
    expect(result).toEqual({
      asset: "ZELD",
      address: ADDR,
      balance: 150_000_000n,
      quantityNormalized: "1.50000000",
      divisible: true,
    });
  });

  it("hits the utxos endpoint for the address", async () => {
    const fetchFn = makeFetch(200, []);
    await getZeldBalance(fetchFn, BASE, ADDR);
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ];
    expect(url).toBe(`${BASE}/addresses/${ADDR}/utxos`);
  });

  it("returns null when the total is 0", async () => {
    const fetchFn = makeFetch(200, [
      { balance: 0, txid: "a".repeat(64), vout: 0 },
    ]);
    expect(await getZeldBalance(fetchFn, BASE, ADDR)).toBeNull();
  });

  it("returns null when there are no UTXOs", async () => {
    const fetchFn = makeFetch(200, []);
    expect(await getZeldBalance(fetchFn, BASE, ADDR)).toBeNull();
  });

  it("normalizes the total against the 8-decimal divisor", async () => {
    const fetchFn = makeFetch(200, [{ balance: 123_456_789 }]);
    const result = await getZeldBalance(fetchFn, BASE, ADDR);
    expect(result?.balance).toBe(123_456_789n);
    expect(BigInt(123_456_789) / ZELD_SATOSHI_DIVISOR).toBe(1n);
    expect(result?.quantityNormalized).toBe("1.23456789");
  });

  it("surfaces the >500 UTXO 400 as a friendly error", async () => {
    const fetchFn = makeFetch(400, {
      error: "More than 500 confirmed UTXOs for this address",
    });
    await expect(getZeldBalance(fetchFn, BASE, ADDR)).rejects.toBeInstanceOf(
      ZeldTooManyUtxosError,
    );
  });

  it("throws a generic error on other HTTP failures", async () => {
    const fetchFn = makeFetch(503, { error: "service unavailable" });
    await expect(getZeldBalance(fetchFn, BASE, ADDR)).rejects.toThrow(
      /ZeldHash API returned 503/,
    );
  });
});
