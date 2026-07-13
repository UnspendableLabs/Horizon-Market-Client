import { describe, expect, it } from "vitest";
import * as btc from "bitcoinjs-lib";
import { LocalSigner } from "../crypto/signer.js";
import { ECPair } from "../crypto/ecc.js";
import type { HttpClient } from "../api/http.js";
import type { SendDeps } from "./types.js";
import {
  prepareCounterparty,
  sendCounterparty,
  type SendCounterpartyParams,
} from "./counterparty.js";

/**
 * Unit tests for the Counterparty composer: it asks counterparty-core to compose
 * a verbose PSBT, backfills each input's prevout from mempool.space (segwit →
 * witnessUtxo, legacy → nonWitnessUtxo), reads the exact fee off the PSBT, then
 * signs + finalizes with a real {@link LocalSigner}. HTTP is a stubbed router;
 * the signer owns every composed input so signing/finalizing succeed for real.
 */

const PRIV = "11".repeat(32);
const signer = new LocalSigner(PRIV, "testnet");
const btcNetwork = btc.networks.testnet;
const A = signer.getAddresses();
const P2WPKH = A.p2wpkh;
const p2wpkhScript = btc.address.toOutputScript(P2WPKH, btcNetwork);
const p2wpkhScriptHex = Buffer.from(p2wpkhScript).toString("hex");
const dummyHttp = {} as unknown as HttpClient;

const CP_BASE = "https://cp.test";
const MEMPOOL_BASE = "https://mempool.space/testnet/api";

const OK_PARAMS: SendCounterpartyParams = {
  fromAddress: P2WPKH,
  asset: "XCP",
  toAddress: P2WPKH,
  quantity: 1_000n,
  satsPerVbyte: 2,
};

// ─── stubbed responses / fetch router ────────────────────────────────────────

function jsonRes(status: number, body: unknown, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function textRes(status: number, text: string, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

interface RouterOpts {
  compose: Response;
  prevOuts?: Record<string, { vout: { value: number; scriptpubkey: string }[] }>;
  rawTxs?: Record<string, string>;
  broadcast?: Response;
  onBroadcast?: (rawHex: string) => void;
}

type RouterFetch = typeof globalThis.fetch & {
  calls: { url: string; method: string }[];
};

function makeRouter(opts: RouterOpts): RouterFetch {
  const calls: { url: string; method: string }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (url.includes("/compose/send")) return opts.compose;

    if (method === "POST" && /\/tx$/.test(url)) {
      opts.onBroadcast?.(String(init?.body ?? ""));
      return opts.broadcast ?? textRes(200, "mempool-broadcast-txid");
    }

    const hexMatch = url.match(/\/tx\/([0-9a-fA-F]+)\/hex$/);
    if (hexMatch) {
      const raw = opts.rawTxs?.[hexMatch[1]];
      if (raw == null) throw new Error(`no rawTx stub for ${hexMatch[1]}`);
      return textRes(200, raw);
    }

    const txMatch = url.match(/\/tx\/([0-9a-fA-F]+)$/);
    if (txMatch) {
      const pv = opts.prevOuts?.[txMatch[1]];
      if (!pv) throw new Error(`no prevOut stub for ${txMatch[1]}`);
      return jsonRes(200, pv);
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as unknown as RouterFetch;
  fn.calls = calls;
  return fn;
}

function deps(
  fetchImpl: typeof globalThis.fetch,
  extra?: Partial<SendDeps>,
): SendDeps {
  return {
    signer,
    fetch: fetchImpl,
    network: "testnet",
    btcNetwork,
    http: dummyHttp,
    counterpartyApiBaseUrl: CP_BASE,
    ...extra,
  };
}

const noFetch = (() => {
  throw new Error("fetch should not be called");
}) as unknown as typeof globalThis.fetch;

// ─── PSBT fixtures ───────────────────────────────────────────────────────────

/**
 * A composed PSBT with two segwit inputs, matching a real counterparty compose:
 * input 0 carries no prevout (forces the mempool backfill → witnessUtxo), input
 * 1 already carries a witnessUtxo (exercises the "already backfilled" skip). One
 * OP_RETURN data output + a change output back to the source.
 */
function witnessComposePsbtB64(): string {
  const psbt = new btc.Psbt({ network: btcNetwork });
  psbt.addInput({ hash: "aa".repeat(32), index: 0 });
  psbt.addInput({
    hash: "bb".repeat(32),
    index: 1,
    witnessUtxo: { script: p2wpkhScript, value: 50_000n },
  });
  psbt.addOutput({
    script: btc.payments.embed({ data: [Buffer.from("counterparty")] }).output!,
    value: 0n,
  });
  psbt.addOutput({ script: p2wpkhScript, value: 149_000n });
  return psbt.toBase64();
}

/** A legacy P2PKH prev-tx owned by the signer (for the nonWitnessUtxo branch). */
function legacyPrevTx(): { rawHex: string; txid: string; scriptHex: string } {
  const pubkey = ECPair.fromPrivateKey(Buffer.from(PRIV, "hex"), {
    network: btcNetwork,
  }).publicKey;
  const script = btc.payments.p2pkh({ pubkey, network: btcNetwork }).output!;
  const tx = new btc.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0), 0);
  tx.addOutput(script, 80_000n);
  return {
    rawHex: tx.toHex(),
    txid: tx.getId(),
    scriptHex: Buffer.from(script).toString("hex"),
  };
}

// ─── happy paths ─────────────────────────────────────────────────────────────

describe("prepareCounterparty", () => {
  it("composes, backfills segwit prevouts, computes the exact fee, signs and broadcasts", async () => {
    let raw = "";
    const router = makeRouter({
      compose: jsonRes(200, { result: { psbt: witnessComposePsbtB64() } }),
      prevOuts: {
        ["aa".repeat(32)]: {
          vout: [{ value: 100_000, scriptpubkey: p2wpkhScriptHex }],
        },
      },
      onBroadcast: (hex) => (raw = hex),
    });

    const prepared = await prepareCounterparty(OK_PARAMS, deps(router));

    expect(prepared.kind).toBe("counterparty");
    // fee = (100_000 + 50_000) inputs − (0 + 149_000) outputs
    expect(prepared.feeSats).toBe(1_000n);

    // compose URL: cpRoot + address + full query (verbose PSBT compose).
    const composeUrl = router.calls[0].url;
    expect(composeUrl.startsWith(`${CP_BASE}/v2/addresses/`)).toBe(true);
    expect(composeUrl).toContain(
      `/addresses/${encodeURIComponent(P2WPKH)}/compose/send?`,
    );
    expect(composeUrl).toContain("asset=XCP");
    expect(composeUrl).toContain("quantity=1000");
    expect(composeUrl).toContain("sat_per_vbyte=2");
    expect(composeUrl).toContain(`pubkeys=${A.publicKey}`);
    expect(composeUrl).toContain("verbose=true");

    // Nothing broadcast until broadcast() is called.
    expect(raw).toBe("");
    const { txid } = await prepared.broadcast();
    expect(raw).not.toBe("");
    const tx = btc.Transaction.fromHex(raw);
    expect(tx.getId()).toBe(txid);
    // Both inputs fully signed (segwit witnesses present).
    expect(tx.ins).toHaveLength(2);
    expect(tx.ins[0].witness.length).toBeGreaterThan(0);
    expect(tx.ins[1].witness.length).toBeGreaterThan(0);
    // A POST broadcast to mempool happened.
    expect(
      router.calls.some((c) => c.method === "POST" && c.url === `${MEMPOOL_BASE}/tx`),
    ).toBe(true);
  });

  it("backfills a legacy prevout as nonWitnessUtxo and reads its value for the fee", async () => {
    const legacy = legacyPrevTx();
    const psbt = new btc.Psbt({ network: btcNetwork });
    psbt.addInput({ hash: legacy.txid, index: 0 });
    psbt.addOutput({ script: p2wpkhScript, value: 79_000n });

    let raw = "";
    const router = makeRouter({
      compose: jsonRes(200, { result: { psbt: psbt.toBase64() } }),
      prevOuts: {
        [legacy.txid]: {
          vout: [{ value: 80_000, scriptpubkey: legacy.scriptHex }],
        },
      },
      rawTxs: { [legacy.txid]: legacy.rawHex },
      onBroadcast: (hex) => (raw = hex),
    });

    const prepared = await prepareCounterparty(OK_PARAMS, deps(router));
    // fee = 80_000 input − 79_000 output.
    expect(prepared.feeSats).toBe(1_000n);

    await prepared.broadcast();
    const tx = btc.Transaction.fromHex(raw);
    // Legacy input finalized (scriptSig present, no witness).
    expect(tx.ins[0].script.length).toBeGreaterThan(0);
    // The raw prev-tx hex was fetched for the nonWitnessUtxo backfill.
    expect(
      router.calls.some((c) => c.url === `${MEMPOOL_BASE}/tx/${legacy.txid}/hex`),
    ).toBe(true);
  });

  it("strips a trailing slash from counterpartyApiBaseUrl (no double slash)", async () => {
    const router = makeRouter({
      compose: jsonRes(200, { result: { psbt: witnessComposePsbtB64() } }),
      prevOuts: {
        ["aa".repeat(32)]: {
          vout: [{ value: 100_000, scriptpubkey: p2wpkhScriptHex }],
        },
      },
    });

    await prepareCounterparty(
      OK_PARAMS,
      deps(router, { counterpartyApiBaseUrl: `${CP_BASE}/` }),
    );
    expect(router.calls[0].url.startsWith(`${CP_BASE}/v2/`)).toBe(true);
    expect(router.calls[0].url).not.toContain("//v2");
  });
});

// ─── guards ──────────────────────────────────────────────────────────────────

describe("prepareCounterparty guards", () => {
  it("throws when counterpartyApiBaseUrl is not configured", async () => {
    await expect(
      prepareCounterparty(
        OK_PARAMS,
        deps(noFetch, { counterpartyApiBaseUrl: undefined }),
      ),
    ).rejects.toThrow(/require a configured counterpartyApiBaseUrl/);
  });

  it("throws when quantity is zero", async () => {
    await expect(
      prepareCounterparty({ ...OK_PARAMS, quantity: 0n }, deps(noFetch)),
    ).rejects.toThrow(/Quantity must be greater than 0/);
  });

  it("throws when quantity is negative", async () => {
    await expect(
      prepareCounterparty({ ...OK_PARAMS, quantity: -5n }, deps(noFetch)),
    ).rejects.toThrow(/Quantity must be greater than 0/);
  });

  it("throws when the fee rate is zero", async () => {
    await expect(
      prepareCounterparty({ ...OK_PARAMS, satsPerVbyte: 0 }, deps(noFetch)),
    ).rejects.toThrow(/Fee rate must be greater than 0/);
  });

  it("throws when the fee rate is negative", async () => {
    await expect(
      prepareCounterparty({ ...OK_PARAMS, satsPerVbyte: -1 }, deps(noFetch)),
    ).rejects.toThrow(/Fee rate must be greater than 0/);
  });
});

// ─── compose failures ────────────────────────────────────────────────────────

describe("prepareCounterparty compose errors", () => {
  it("surfaces the counterparty-core error message on a non-2xx compose", async () => {
    const router = makeRouter({
      compose: jsonRes(
        400,
        { error: { message: "Insufficient XCP balance" } },
        "Bad Request",
      ),
    });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /Counterparty compose returned 400: Insufficient XCP balance/,
    );
  });

  it("falls back to statusText when the error body has no message", async () => {
    const router = makeRouter({
      compose: jsonRes(404, {}, "Not Found"),
    });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /Counterparty compose returned 404: Not Found/,
    );
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    const badJson = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("not json");
      },
      text: async () => "",
    } as unknown as Response;
    const router = makeRouter({ compose: badJson });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /Counterparty compose returned 502: Bad Gateway/,
    );
  });

  it("throws when compose returns no result", async () => {
    const router = makeRouter({ compose: jsonRes(200, {}) });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /did not return a PSBT/,
    );
  });

  it("throws when the result carries no PSBT string", async () => {
    const router = makeRouter({
      compose: jsonRes(200, { result: { rawtransaction: "deadbeef" } }),
    });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /did not return a PSBT/,
    );
  });

  it("throws when the PSBT field is not a string", async () => {
    const router = makeRouter({
      compose: jsonRes(200, { result: { psbt: 123 } }),
    });
    await expect(prepareCounterparty(OK_PARAMS, deps(router))).rejects.toThrow(
      /did not return a PSBT/,
    );
  });
});

// ─── one-shot wrapper ────────────────────────────────────────────────────────

describe("sendCounterparty", () => {
  it("composes, signs and broadcasts in one shot", async () => {
    let raw = "";
    const router = makeRouter({
      compose: jsonRes(200, { result: { psbt: witnessComposePsbtB64() } }),
      prevOuts: {
        ["aa".repeat(32)]: {
          vout: [{ value: 100_000, scriptpubkey: p2wpkhScriptHex }],
        },
      },
      onBroadcast: (hex) => (raw = hex),
    });

    const { txid } = await sendCounterparty(OK_PARAMS, deps(router));
    expect(raw).not.toBe("");
    expect(btc.Transaction.fromHex(raw).getId()).toBe(txid);
  });
});
