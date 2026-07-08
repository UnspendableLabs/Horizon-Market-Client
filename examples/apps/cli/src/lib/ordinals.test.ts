import { describe, it, expect } from "vitest";
import {
  resolveInscriptionUtxo,
  fetchInscriptionUtxos,
  protectedUtxoIds,
} from "./ordinals.js";

const ORD = "https://ord.example";

/** A minimal `fetch` stub that routes on the request URL. */
function stubFetch(
  routes: Record<string, unknown>,
  status: (url: string) => number = () => 200,
): typeof globalThis.fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    const code = status(url);
    return Promise.resolve({
      ok: code >= 200 && code < 300,
      status: code,
      json: () => Promise.resolve(routes[url]),
    } as Response);
  }) as typeof globalThis.fetch;
}

describe("resolveInscriptionUtxo", () => {
  it("maps a satpoint (txid:vout:offset) to a utxo id (txid:vout)", async () => {
    const fetchImpl = stubFetch({
      [`${ORD}/inscription/insc1`]: { satpoint: "deadbeef:2:0" },
    });
    expect(await resolveInscriptionUtxo(fetchImpl, ORD, "insc1")).toBe("deadbeef:2");
  });

  it("strips a trailing slash from the ord base url", async () => {
    const fetchImpl = stubFetch({
      [`${ORD}/inscription/insc1`]: { satpoint: "aa:1:0" },
    });
    expect(await resolveInscriptionUtxo(fetchImpl, `${ORD}/`, "insc1")).toBe("aa:1");
  });

  it("throws NO_ORD_API when no ord base url is configured", async () => {
    await expect(
      resolveInscriptionUtxo(stubFetch({}), undefined, "insc1"),
    ).rejects.toMatchObject({ code: "NO_ORD_API" });
  });

  it("throws INSCRIPTION_UNRESOLVED for an unparseable satpoint", async () => {
    const fetchImpl = stubFetch({
      [`${ORD}/inscription/insc1`]: { satpoint: "no-colon" },
    });
    await expect(
      resolveInscriptionUtxo(fetchImpl, ORD, "insc1"),
    ).rejects.toMatchObject({ code: "INSCRIPTION_UNRESOLVED" });
  });
});

describe("fetchInscriptionUtxos", () => {
  it("enumerates inscriptions across addresses and resolves their utxos + numbers", async () => {
    const fetchImpl = stubFetch({
      [`${ORD}/address/addrA`]: { inscriptions: ["i1", "i2"] },
      [`${ORD}/address/addrB`]: { inscriptions: [] },
      [`${ORD}/inscription/i1`]: { satpoint: "t1:0:0", number: 42 },
      [`${ORD}/inscription/i2`]: { satpoint: "t2:1:0" },
    });
    const utxos = await fetchInscriptionUtxos(fetchImpl, ORD, ["addrA", "addrB"]);
    expect(utxos).toEqual([
      { inscriptionId: "i1", utxoId: "t1:0", inscriptionNumber: 42, address: "addrA" },
      { inscriptionId: "i2", utxoId: "t2:1", inscriptionNumber: null, address: "addrA" },
    ]);
  });

  it("returns [] when no ord base url is configured", async () => {
    expect(await fetchInscriptionUtxos(stubFetch({}), undefined, ["a"])).toEqual([]);
  });
});

describe("protectedUtxoIds", () => {
  it("returns the flat list of holding utxo ids", async () => {
    const fetchImpl = stubFetch({
      [`${ORD}/address/addrA`]: { inscriptions: ["i1"] },
      [`${ORD}/inscription/i1`]: { satpoint: "t1:3:0" },
    });
    expect(await protectedUtxoIds(fetchImpl, ORD, ["addrA"])).toEqual(["t1:3"]);
  });

  it("is best-effort: swallows ord errors and returns []", async () => {
    const fetchImpl = stubFetch({}, () => 500);
    expect(await protectedUtxoIds(fetchImpl, ORD, ["addrA"])).toEqual([]);
  });
});
