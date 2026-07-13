import { describe, expect, it } from "vitest";
import { getCounterpartyBalances } from "./counterparty.js";
import { makeFetch } from "../test-utils.js";

const BASE = "https://api.counterparty.io:4000";
const ADDR = "bc1qowner";

// 2^53 — the smallest integer that JSON's IEEE-754 doubles can no longer
// represent exactly, so `res.json()` rounds it and the base-unit bigint must be
// rebuilt from `quantity_normalized`. (Written as a literal it collapses to
// 9007199254740992, which is still `!Number.isSafeInteger`.)
const UNSAFE = 9007199254740993;

function page(result: unknown[]) {
  return { result, next_cursor: null };
}

// Exercises the large-balance rebuild path (lines 71-77) and every branch of
// `normalizedToBigInt` (lines 52-59), none of which the existing suite reaches.
describe("getCounterpartyBalances — large-quantity precision rebuild", () => {
  it("rebuilds a divisible base-unit bigint from quantity_normalized when quantity overflows 2^53", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "BIGDIV",
          quantity: UNSAFE,
          quantity_normalized: "90071992.54740993",
          asset_info: { divisible: true },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    // 90071992 * 1e8 + 54740993 — exact, not the rounded double.
    expect(b.quantity).toBe(9007199254740993n);
    expect(b.divisible).toBe(true);
    expect(b.quantityNormalized).toBe("90071992.54740993");
  });

  it("rebuilds a non-divisible integer bigint from quantity_normalized", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "BIGIND",
          quantity: UNSAFE,
          quantity_normalized: "9007199254740993",
          asset_info: { divisible: false },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(b.quantity).toBe(9007199254740993n);
  });

  it("falls back to the rounded quantity when the normalized string is not numeric", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "BADNORM",
          quantity: UNSAFE,
          quantity_normalized: "not-a-number",
          asset_info: { divisible: true },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    // normalizedToBigInt returns null -> keeps the float-rounded bigint.
    expect(b.quantity).toBe(BigInt(Math.trunc(UNSAFE)));
    expect(b.quantityNormalized).toBe("not-a-number");
  });

  it("falls back when a non-divisible normalized value carries a fraction", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "INDDEC",
          quantity: UNSAFE,
          quantity_normalized: "9007199254740993.5",
          asset_info: { divisible: false },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(b.quantity).toBe(BigInt(Math.trunc(UNSAFE)));
  });

  it("falls back when a divisible normalized value has more than 8 fraction digits", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "TOODEEP",
          quantity: UNSAFE,
          quantity_normalized: "1.123456789",
          asset_info: { divisible: true },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(b.quantity).toBe(BigInt(Math.trunc(UNSAFE)));
  });
});

// Exercises `toBigInt`'s string + null branches (lines 46-49) and the
// `quantity.toString()` normalized fallback (line 82).
describe("getCounterpartyBalances — quantity coercion & normalized fallback", () => {
  it("parses a numeric string quantity", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "STRQTY",
          quantity: "42",
          quantity_normalized: "42",
          asset_info: { divisible: false },
        },
      ]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(b.quantity).toBe(42n);
  });

  it("skips a row whose quantity cannot be parsed to a bigint", async () => {
    const fetchFn = makeFetch(
      200,
      page([
        {
          asset: "BADQTY",
          quantity: "abc",
          quantity_normalized: "abc",
          asset_info: { divisible: false },
        },
        {
          asset: "GOOD",
          quantity: 5,
          quantity_normalized: "5",
          asset_info: { divisible: false },
        },
      ]),
    );
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances.map((x) => x.asset)).toEqual(["GOOD"]);
  });

  it("uses quantity.toString() for quantityNormalized when the field is absent", async () => {
    const fetchFn = makeFetch(
      200,
      page([{ asset: "NONORM", quantity: 7, asset_info: { divisible: false } }]),
    );
    const [b] = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(b.quantity).toBe(7n);
    expect(b.quantityNormalized).toBe("7");
  });
});
