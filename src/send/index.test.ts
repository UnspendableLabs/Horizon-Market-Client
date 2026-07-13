import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PreparedSend, SendDeps, SendRequest } from "./types.js";

/**
 * Unit tests for the send dispatcher (`prepareSend` / `sendAsset`). Every family
 * composer is mocked so we assert only the router's job: dispatch by `kind`,
 * map the request into the composer's params (dropping fields the composer does
 * not take, e.g. `divisible`), gate the Kontor branches behind
 * `assertKontorRuntime`, and pass the composed handle straight through.
 */

vi.mock("./btc.js", () => ({ prepareBtc: vi.fn() }));
vi.mock("./counterparty.js", () => ({ prepareCounterparty: vi.fn() }));
vi.mock("./zeld.js", () => ({ prepareZeld: vi.fn() }));
vi.mock("./ordinal.js", () => ({ prepareOrdinal: vi.fn() }));
vi.mock("./kontor.js", () => ({
  prepareKontorToken: vi.fn(),
  prepareKontorNft: vi.fn(),
}));
vi.mock("../kontor/runtime.js", () => ({ assertKontorRuntime: vi.fn() }));

import { prepareSend, sendAsset } from "./index.js";
import { prepareBtc } from "./btc.js";
import { prepareCounterparty } from "./counterparty.js";
import { prepareZeld } from "./zeld.js";
import { prepareOrdinal } from "./ordinal.js";
import { prepareKontorToken, prepareKontorNft } from "./kontor.js";
import { assertKontorRuntime } from "../kontor/runtime.js";

const deps = { network: "testnet" } as unknown as SendDeps;

function fakePrepared(overrides?: Partial<PreparedSend>): PreparedSend {
  return {
    kind: "btc",
    feeSats: 123n,
    broadcast: vi.fn().mockResolvedValue({ txid: "tx-abc" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("prepareSend dispatch", () => {
  it("routes btc → prepareBtc with the mapped params", async () => {
    const prepared = fakePrepared();
    vi.mocked(prepareBtc).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "btc",
      toAddress: "tb1qdest",
      amountSats: 50_000n,
      satsPerVbyte: 3,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(prepareBtc).toHaveBeenCalledWith(
      { toAddress: "tb1qdest", amountSats: 50_000n, satsPerVbyte: 3 },
      deps,
    );
  });

  it("routes counterparty → prepareCounterparty and drops `divisible`", async () => {
    const prepared = fakePrepared({ kind: "counterparty" });
    vi.mocked(prepareCounterparty).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "counterparty",
      fromAddress: "tb1qfrom",
      asset: "XCP",
      toAddress: "tb1qto",
      quantity: 1_000n,
      divisible: true,
      satsPerVbyte: 2,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(prepareCounterparty).toHaveBeenCalledWith(
      {
        fromAddress: "tb1qfrom",
        asset: "XCP",
        toAddress: "tb1qto",
        quantity: 1_000n,
        satsPerVbyte: 2,
      },
      deps,
    );
    // `divisible` is not part of the composer's params.
    expect(vi.mocked(prepareCounterparty).mock.calls[0][0]).not.toHaveProperty(
      "divisible",
    );
  });

  it("routes zeld → prepareZeld with the mapped params", async () => {
    const prepared = fakePrepared({ kind: "zeld" });
    vi.mocked(prepareZeld).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "zeld",
      fromAddress: "tb1qfrom",
      toAddress: "tb1qto",
      amount: 200n,
      satsPerVbyte: 5,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(prepareZeld).toHaveBeenCalledWith(
      { fromAddress: "tb1qfrom", toAddress: "tb1qto", amount: 200n, satsPerVbyte: 5 },
      deps,
    );
  });

  it("routes ordinal → prepareOrdinal with the mapped params", async () => {
    const prepared = fakePrepared({ kind: "ordinal" });
    vi.mocked(prepareOrdinal).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "ordinal",
      fromAddress: "tb1pfrom",
      utxoId: "ab".repeat(32) + ":0",
      toAddress: "tb1qto",
      satsPerVbyte: 4,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(prepareOrdinal).toHaveBeenCalledWith(
      {
        fromAddress: "tb1pfrom",
        utxoId: "ab".repeat(32) + ":0",
        toAddress: "tb1qto",
        satsPerVbyte: 4,
      },
      deps,
    );
  });

  it("routes kor → asserts the Kontor runtime then prepareKontorToken", async () => {
    const prepared = fakePrepared({ kind: "kor", feeSats: null });
    vi.mocked(prepareKontorToken).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "kor",
      toAddress: "tb1pdest",
      amount: "100.5",
      satsPerVbyte: 1,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(assertKontorRuntime).toHaveBeenCalledTimes(1);
    expect(prepareKontorToken).toHaveBeenCalledWith(
      { toAddress: "tb1pdest", amount: "100.5", satsPerVbyte: 1 },
      deps,
    );
  });

  it("routes kontor-nft → asserts the Kontor runtime then prepareKontorNft", async () => {
    const prepared = fakePrepared({ kind: "kontor-nft", feeSats: null });
    vi.mocked(prepareKontorNft).mockResolvedValue(prepared);
    const req: SendRequest = {
      kind: "kontor-nft",
      contractAddress: "C1",
      nftId: "7",
      toAddress: "tb1pdest",
      satsPerVbyte: 4,
    };

    const result = await prepareSend(req, deps);

    expect(result).toBe(prepared);
    expect(assertKontorRuntime).toHaveBeenCalledTimes(1);
    expect(prepareKontorNft).toHaveBeenCalledWith(
      {
        contractAddress: "C1",
        nftId: "7",
        toAddress: "tb1pdest",
        satsPerVbyte: 4,
      },
      deps,
    );
  });

  it("rejects a kor send when the Kontor runtime is unavailable (no composer call)", async () => {
    vi.mocked(assertKontorRuntime).mockImplementation(() => {
      throw new Error("Kontor is unavailable in this environment");
    });
    await expect(
      prepareSend({ kind: "kor", toAddress: "tb1pdest", amount: "1" }, deps),
    ).rejects.toThrow(/unavailable/);
    expect(prepareKontorToken).not.toHaveBeenCalled();
  });

  it("rejects a kontor-nft send when the Kontor runtime is unavailable (no composer call)", async () => {
    vi.mocked(assertKontorRuntime).mockImplementation(() => {
      throw new Error("Kontor is unavailable in this environment");
    });
    await expect(
      prepareSend(
        { kind: "kontor-nft", contractAddress: "C1", nftId: "7", toAddress: "tb1pdest" },
        deps,
      ),
    ).rejects.toThrow(/unavailable/);
    expect(prepareKontorNft).not.toHaveBeenCalled();
  });
});

describe("sendAsset", () => {
  it("prepares then broadcasts, returning the broadcast txid", async () => {
    const prepared = fakePrepared();
    vi.mocked(prepareBtc).mockResolvedValue(prepared);

    const result = await sendAsset(
      { kind: "btc", toAddress: "tb1qdest", amountSats: 1n, satsPerVbyte: 1 },
      deps,
    );

    expect(prepareBtc).toHaveBeenCalledTimes(1);
    expect(prepared.broadcast).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ txid: "tx-abc" });
  });
});
