import { describe, expect, it } from "vitest";
import * as btc from "bitcoinjs-lib";
import type { HttpClient } from "../api/http.js";
import { LocalSigner } from "../crypto/signer.js";
import { sendBtc } from "./btc.js";
import { sendZeld } from "./zeld.js";
import { sendOrdinal } from "./ordinal.js";
import { decodeZeldOpReturnScript } from "./zeld-opreturn.js";
import type { SendDeps } from "./types.js";

/**
 * End-to-end tests for the local bitcoinjs composers (BTC / ZELD / ordinal):
 * a real `LocalSigner` composes, signs, finalizes and "broadcasts" against a
 * stubbed mempool / ZeldHash `fetch` — validating UTXO selection, PSBT signing,
 * finalization, and (for ZELD) the OP_RETURN distribution, with no network.
 */

const PRIV = "11".repeat(32);
const signer = new LocalSigner(PRIV, "testnet");
const A = signer.getAddresses();
const P2WPKH = A.p2wpkh;
const P2TR = A.p2tr!;
const btcNetwork = btc.networks.testnet;
const dummyHttp = {} as unknown as HttpClient;

interface StubUtxo {
  txid: string;
  vout: number;
  value: number;
}

function res(json: unknown, text = ""): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
    text: async () => text,
  } as unknown as Response;
}

/**
 * A stubbed fetch backed by an in-memory map of address → UTXOs and txid → vouts.
 * Captures the raw tx broadcast to `POST …/tx`.
 */
function makeFetch(opts: {
  utxosByAddress?: Record<string, StubUtxo[]>;
  zeldUtxos?: { txid: string; vout: number; balance: number }[];
  prevOuts?: Record<string, { value: number; script: string }[]>;
  onBroadcast?: (rawHex: string) => void;
}): typeof globalThis.fetch {
  const scriptHex = (addr: string) =>
    Buffer.from(btc.address.toOutputScript(addr, btcNetwork)).toString("hex");
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "POST" && url.endsWith("/tx")) {
      opts.onBroadcast?.(String(init?.body ?? ""));
      return res(null, "broadcast-txid");
    }
    // GET /address/{addr}/utxo
    const utxoMatch = url.match(/\/address\/([^/]+)\/utxo$/);
    if (utxoMatch) {
      const addr = decodeURIComponent(utxoMatch[1]);
      const list = opts.utxosByAddress?.[addr] ?? [];
      return res(list.map((u) => ({ ...u, status: { confirmed: true } })));
    }
    // ZeldHash GET /addresses/{addr}/utxos
    if (url.includes("/addresses/") && url.endsWith("/utxos")) {
      return res(opts.zeldUtxos ?? []);
    }
    // GET /tx/{txid}
    const txMatch = url.match(/\/tx\/([0-9a-fA-F]+)$/);
    if (txMatch) {
      const txid = txMatch[1];
      const vout = (opts.prevOuts?.[txid] ?? []).map((o) => ({
        value: o.value,
        scriptpubkey: o.script,
      }));
      return res({ vout });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as unknown as typeof globalThis.fetch;
}

function baseDeps(fetchImpl: typeof globalThis.fetch): SendDeps {
  return {
    signer,
    fetch: fetchImpl,
    network: "testnet",
    btcNetwork,
    http: dummyHttp,
  };
}

describe("sendBtc", () => {
  it("selects UTXOs, signs, finalizes and broadcasts a valid tx", async () => {
    let raw = "";
    const fetchImpl = makeFetch({
      utxosByAddress: {
        [P2WPKH]: [{ txid: "aa".repeat(32), vout: 0, value: 100_000 }],
        [P2TR]: [],
      },
      onBroadcast: (hex) => (raw = hex),
    });

    const { txid } = await sendBtc(
      { toAddress: P2TR, amountSats: 50_000n, satsPerVbyte: 2 },
      baseDeps(fetchImpl),
    );

    expect(raw).not.toBe("");
    const tx = btc.Transaction.fromHex(raw);
    expect(tx.getId()).toBe(txid);
    // Fully signed (segwit witness present).
    expect(tx.ins[0].witness.length).toBeGreaterThan(0);
    // Output 0 pays the destination exactly the requested amount.
    const destScript = btc.address.toOutputScript(P2TR, btcNetwork);
    const destOut = tx.outs.find(
      (o) => Buffer.compare(o.script, destScript) === 0 && o.value === 50_000n,
    );
    expect(destOut).toBeTruthy();
    // Change returns to the P2WPKH address; fee is positive and small.
    const totalOut = tx.outs.reduce((s, o) => s + o.value, 0n);
    const fee = 100_000n - totalOut;
    expect(fee).toBeGreaterThan(0n);
    expect(fee).toBeLessThan(2_000n);
  });

  it("throws when the balance can't cover amount + fee", async () => {
    const fetchImpl = makeFetch({
      utxosByAddress: { [P2WPKH]: [{ txid: "bb".repeat(32), vout: 0, value: 1_000 }], [P2TR]: [] },
    });
    await expect(
      sendBtc({ toAddress: P2TR, amountSats: 50_000n, satsPerVbyte: 2 }, baseDeps(fetchImpl)),
    ).rejects.toThrow(/Insufficient/);
  });
});

describe("sendZeld", () => {
  it("moves ZELD via the OP_RETURN distribution with change back to sender", async () => {
    let raw = "";
    const zeldTxid = "cc".repeat(32);
    const fundTxid = "dd".repeat(32);
    const fetchImpl = makeFetch({
      zeldUtxos: [{ txid: zeldTxid, vout: 0, balance: 500 }],
      utxosByAddress: {
        // The ZELD UTXO (small) + a pure-BTC funding UTXO on the same address.
        [P2WPKH]: [
          { txid: zeldTxid, vout: 0, value: 1_000 },
          { txid: fundTxid, vout: 0, value: 50_000 },
        ],
      },
      onBroadcast: (hex) => (raw = hex),
    });

    await sendZeld(
      { fromAddress: P2WPKH, toAddress: P2TR, amount: 200n, satsPerVbyte: 2 },
      { ...baseDeps(fetchImpl), zeldApiBaseUrl: "https://zeld.test" },
    );

    expect(raw).not.toBe("");
    const tx = btc.Transaction.fromHex(raw);
    // Output 0 → recipient (dust), and the last output is the ZELD OP_RETURN.
    const destScript = btc.address.toOutputScript(P2TR, btcNetwork);
    expect(Buffer.compare(tx.outs[0].script, destScript)).toBe(0);
    expect(tx.outs[0].value).toBe(330n);
    const opReturn = tx.outs[tx.outs.length - 1];
    const dist = decodeZeldOpReturnScript(opReturn.script);
    // [recipient=200, zeld-change=300, btc-change=0].
    expect(dist).toEqual([200n, 300n, 0n]);
    // The pure-BTC funding UTXO was spent (2 inputs: ZELD + funding).
    expect(tx.ins.length).toBe(2);
  });
});

describe("sendOrdinal", () => {
  it("spends the inscription as input 0 and never as fee funding", async () => {
    let raw = "";
    const insTxid = "ee".repeat(32);
    const fundTxid = "ff".repeat(32);
    const insScript = Buffer.from(
      btc.address.toOutputScript(P2TR, btcNetwork),
    ).toString("hex");
    const fetchImpl = makeFetch({
      prevOuts: { [insTxid]: [{ value: 10_000, script: insScript }] },
      utxosByAddress: {
        // Funding lives on P2WPKH; the inscription also shows up on P2TR's list.
        [P2WPKH]: [{ txid: fundTxid, vout: 0, value: 50_000 }],
        [P2TR]: [{ txid: insTxid, vout: 0, value: 10_000 }],
      },
      onBroadcast: (hex) => (raw = hex),
    });

    const { txid } = await sendOrdinal(
      {
        fromAddress: P2TR,
        utxoId: `${insTxid}:0`,
        toAddress: P2WPKH,
        satsPerVbyte: 2,
      },
      baseDeps(fetchImpl),
    );

    const tx = btc.Transaction.fromHex(raw);
    expect(tx.getId()).toBe(txid);
    // Input 0 is the inscription outpoint (hash is little-endian internally).
    const in0Txid = Buffer.from(tx.ins[0].hash).reverse().toString("hex");
    expect(in0Txid).toBe(insTxid);
    expect(tx.ins[0].index).toBe(0);
    // The inscription is spent exactly once (asset-safety: not re-added as funding).
    const inscriptionInputs = tx.ins.filter(
      (i) => Buffer.from(i.hash).reverse().toString("hex") === insTxid,
    );
    expect(inscriptionInputs.length).toBe(1);
    // Output 0 pays the destination the full inscription value (offset preserved).
    const destScript = btc.address.toOutputScript(P2WPKH, btcNetwork);
    expect(Buffer.compare(tx.outs[0].script, destScript)).toBe(0);
    expect(tx.outs[0].value).toBe(10_000n);
  });
});
