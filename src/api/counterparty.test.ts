import { describe, it, expect, vi } from "vitest";
import { getCounterpartyBalances } from "./counterparty.js";
import { makeFetch, makeSequentialFetch } from "../test-utils.js";

const BASE = "https://api.counterparty.io:4000";
const ADDR = "bc1qowner";

function row(
  asset: string,
  quantity: number | string,
  quantityNormalized: string,
  divisible: boolean,
  assetLongname: string | null = null,
) {
  return {
    asset,
    quantity,
    quantity_normalized: quantityNormalized,
    asset_info: { divisible, asset_longname: assetLongname },
  };
}

describe("getCounterpartyBalances", () => {
  it("maps rows to base-unit balances tagged with the address", async () => {
    const fetchFn = makeFetch(200, {
      result: [
        row("XCP", 1250000000, "12.5", true),
        row("RAREPEPE", 3, "3", false),
      ],
      next_cursor: null,
    });
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances).toEqual([
      {
        asset: "XCP",
        assetLongname: null,
        address: ADDR,
        quantity: 1250000000n,
        quantityNormalized: "12.5",
        divisible: true,
      },
      {
        asset: "RAREPEPE",
        assetLongname: null,
        address: ADDR,
        quantity: 3n,
        quantityNormalized: "3",
        divisible: false,
      },
    ]);
  });

  it("captures the subasset long name from asset_info", async () => {
    const fetchFn = makeFetch(200, {
      result: [
        row("A4950153011122931022", 5, "5", false, "PEPENARDO.CARD"),
      ],
      next_cursor: null,
    });
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances).toEqual([
      {
        asset: "A4950153011122931022",
        assetLongname: "PEPENARDO.CARD",
        address: ADDR,
        quantity: 5n,
        quantityNormalized: "5",
        divisible: false,
      },
    ]);
  });

  it("hits the v2 balances endpoint for the address", async () => {
    const fetchFn = makeFetch(200, { result: [], next_cursor: null });
    await getCounterpartyBalances(fetchFn, BASE, ADDR);
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
    ];
    expect(url).toContain(`${BASE}/v2/addresses/${ADDR}/balances`);
    expect(url).toContain("type=address");
  });

  it("follows next_cursor pagination", async () => {
    const fetchFn = makeSequentialFetch(
      {
        status: 200,
        body: {
          result: [row("AAA", 1, "1", false)],
          next_cursor: "cursor-2",
        },
      },
      {
        status: 200,
        body: { result: [row("BBB", 2, "2", false)], next_cursor: null },
      },
    );
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances.map((b) => b.asset)).toEqual(["AAA", "BBB"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [secondUrl] = (fetchFn as ReturnType<typeof vi.fn>).mock
      .calls[1] as [string];
    expect(secondUrl).toContain("cursor=cursor-2");
  });

  it("skips ZELD rows (handled by its own protocol)", async () => {
    const fetchFn = makeFetch(200, {
      result: [row("ZELD", 100000000, "1", true), row("XCP", 1, "1", false)],
      next_cursor: null,
    });
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances.map((b) => b.asset)).toEqual(["XCP"]);
  });

  it("skips zero / non-positive balances", async () => {
    const fetchFn = makeFetch(200, {
      result: [row("ZEROCOIN", 0, "0", false)],
      next_cursor: null,
    });
    const balances = await getCounterpartyBalances(fetchFn, BASE, ADDR);
    expect(balances).toEqual([]);
  });

  it("throws on HTTP error", async () => {
    const fetchFn = makeFetch(500, {});
    await expect(getCounterpartyBalances(fetchFn, BASE, ADDR)).rejects.toThrow(
      /Counterparty API returned 500/,
    );
  });

  it("throws on an API error body", async () => {
    const fetchFn = makeFetch(200, { error: { message: "bad address" } });
    await expect(getCounterpartyBalances(fetchFn, BASE, ADDR)).rejects.toThrow(
      /bad address/,
    );
  });
});
