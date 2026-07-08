import { describe, it, expect, vi } from "vitest";
import type { HorizonMarketClient } from "@unspendablelabs/horizon-market-client";
import { findCounterpartyAsset, findZeldAsset } from "./assets.js";

const ADDRS = { p2wpkh: "bc1qseg", p2tr: "bc1ptap" };

describe("findCounterpartyAsset", () => {
  it("returns the owned asset's address, balance and divisibility", async () => {
    const getCounterpartyBalances = vi.fn().mockResolvedValue([
      {
        asset: "XCP",
        address: ADDRS.p2wpkh,
        quantity: 250_000_000n,
        quantityNormalized: "2.5",
        divisible: true,
      },
      {
        asset: "RAREPEPE",
        address: ADDRS.p2tr,
        quantity: 3n,
        quantityNormalized: "3",
        divisible: false,
      },
    ]);
    const client = { getCounterpartyBalances } as unknown as HorizonMarketClient;

    const owned = await findCounterpartyAsset(client, ADDRS, "RAREPEPE");
    expect(owned).toEqual({
      assetName: "RAREPEPE",
      address: ADDRS.p2tr,
      balance: 3n,
      quantityNormalized: "3",
      divisible: false,
    });
    expect(getCounterpartyBalances).toHaveBeenCalledWith([ADDRS.p2wpkh, ADDRS.p2tr]);
  });

  it("throws ASSET_NOT_OWNED when the asset is not held", async () => {
    const client = {
      getCounterpartyBalances: vi.fn().mockResolvedValue([]),
    } as unknown as HorizonMarketClient;
    await expect(findCounterpartyAsset(client, ADDRS, "NOPE")).rejects.toMatchObject({
      code: "ASSET_NOT_OWNED",
    });
  });
});

describe("findZeldAsset", () => {
  it("returns the first non-zero ZELD balance", async () => {
    const client = {
      getZeldBalances: vi.fn().mockResolvedValue([
        { asset: "ZELD", address: ADDRS.p2tr, balance: 0n, quantityNormalized: "0" },
        { asset: "ZELD", address: ADDRS.p2wpkh, balance: 500n, quantityNormalized: "0.00000500" },
      ]),
    } as unknown as HorizonMarketClient;
    const owned = await findZeldAsset(client, ADDRS);
    expect(owned).toEqual({
      address: ADDRS.p2wpkh,
      balance: 500n,
      quantityNormalized: "0.00000500",
    });
  });

  it("throws ASSET_NOT_OWNED when no ZELD is held", async () => {
    const client = {
      getZeldBalances: vi.fn().mockResolvedValue([
        { asset: "ZELD", address: ADDRS.p2wpkh, balance: 0n, quantityNormalized: "0" },
      ]),
    } as unknown as HorizonMarketClient;
    await expect(findZeldAsset(client, ADDRS)).rejects.toMatchObject({
      code: "ASSET_NOT_OWNED",
    });
  });
});
