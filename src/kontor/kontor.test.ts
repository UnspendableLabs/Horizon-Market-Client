import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { Identity, signet } from "@kontor/sdk";
import { resolveKontorChain, kontorNativeTokenAddress } from "./chain.js";
import {
  attachRevealTxidFromBlob,
  attachRevealEscrowFromBlob,
} from "./contracts.js";
import { getKontorSigning } from "./signing.js";
import {
  fetchKontorFundingUtxos,
  resolveKontorFunding,
  taprootScriptPubKeyHex,
} from "./funding.js";
import { LocalSigner, type Signer } from "../crypto/signer.js";
import { HttpClient } from "../api/http.js";
import { createKontorFeeQuote } from "../api/kontor.js";

const TEST_KEY =
  "0101010101010101010101010101010101010101010101010101010101010101";

// A minimal, valid raw bitcoin tx (1 empty input, 1 zero-value OP_RETURN-less output).
const RAW_TX_HEX =
  "0200000001" +
  "00".repeat(32) +
  "00000000" +
  "00" +
  "ffffffff" +
  "01" +
  "0000000000000000" +
  "00" +
  "00000000";

// Same shape as RAW_TX_HEX but output 0 carries 546 sats (the escrow value).
const RAW_TX_HEX_546 =
  "0200000001" +
  "00".repeat(32) +
  "00000000" +
  "00" +
  "ffffffff" +
  "01" +
  "2202000000000000" +
  "00" +
  "00000000";

describe("resolveKontorChain", () => {
  it("returns the signet chain for 'signet'", () => {
    expect(resolveKontorChain("signet")).toBe(signet);
  });
  it("returns null for unsupported networks", () => {
    expect(resolveKontorChain("mainnet")).toBeNull();
    expect(resolveKontorChain("testnet")).toBeNull();
    expect(resolveKontorChain(undefined)).toBeNull();
  });
});

describe("kontorNativeTokenAddress", () => {
  it("resolves the native KOR token address on signet", () => {
    expect(kontorNativeTokenAddress(signet)).toBe("token@0.0");
  });
});

describe("attachRevealTxidFromBlob", () => {
  it("extracts the attach-reveal txid", () => {
    const expected = btc.Transaction.fromHex(RAW_TX_HEX).getId();
    const blob = JSON.stringify({ v: 1, attachReveal: RAW_TX_HEX });
    expect(attachRevealTxidFromBlob(blob)).toBe(expected);
  });
  it("rejects an unsupported blob version", () => {
    expect(() =>
      attachRevealTxidFromBlob(JSON.stringify({ v: 2, attachReveal: RAW_TX_HEX })),
    ).toThrow(/version/);
  });
  it("rejects invalid JSON", () => {
    expect(() => attachRevealTxidFromBlob("not-json")).toThrow(/JSON/);
  });
  it("rejects a missing attachReveal", () => {
    expect(() => attachRevealTxidFromBlob(JSON.stringify({ v: 1 }))).toThrow(
      /attachReveal/,
    );
  });
});

describe("attachRevealEscrowFromBlob", () => {
  it("extracts the escrow txid and output-0 value (sats)", () => {
    const tx = btc.Transaction.fromHex(RAW_TX_HEX_546);
    const blob = JSON.stringify({ v: 1, attachReveal: RAW_TX_HEX_546 });
    expect(attachRevealEscrowFromBlob(blob)).toEqual({
      txid: tx.getId(),
      value: 546,
    });
  });
});

describe("getKontorSigning", () => {
  it("throws a clear error for a signer with neither getKontorSigning nor a taproot identity", async () => {
    const signer: Signer = {
      getAddresses: () => ({ p2wpkh: "tb1qx", publicKey: "00" }),
      signPsbtHex: () => "",
      signMessage: () => "",
    };
    await expect(getKontorSigning(signer, signet)).rejects.toThrow(
      /getKontorSigning|x-only public key/,
    );
  });

  it("derives a Signing from a LocalSigner (key never leaves the signer)", async () => {
    const signer = new LocalSigner(TEST_KEY, "testnet");
    const signing = await getKontorSigning(signer, signet);
    // The Signing carries a taproot identity address — no key is exposed.
    expect(typeof (signing as { identity: { address: string } }).identity.address).toBe(
      "string",
    );
  });

  it("falls back to a wallet-backed Signing for an external signer (no key)", async () => {
    const xOnly = "ab".repeat(32);
    const p2tr = Identity.fromXOnly(xOnly, signet).address;
    // An external wallet signer: no getKontorSigning, but exposes its taproot
    // identity and signs PSBTs asynchronously through the wallet.
    const signer: Signer = {
      getAddresses: () => ({
        p2wpkh: "tb1qx",
        p2tr,
        publicKey: "00",
        xOnlyPubkey: xOnly,
      }),
      signPsbtHex: (psbtHex) => psbtHex,
      signMessage: () => "",
    };
    const signing = await getKontorSigning(signer, signet);
    expect((signing as { identity: { address: string } }).identity.address).toBe(
      p2tr,
    );
  });
});

describe("fetchKontorFundingUtxos (key safety)", () => {
  it("sends only the address (GET, no body, no key) and maps confirmed UTXOs", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        status: 200,
        json: async () => ({
          data: [
            { txid: "aa".repeat(32), vout: 0, value: 1000, status: { confirmed: true } },
            { txid: "bb".repeat(32), vout: 1, value: 2000, status: { confirmed: false } },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const p2tr = new LocalSigner(TEST_KEY, "testnet").getAddresses().p2tr!;

    const utxos = await fetchKontorFundingUtxos(http, p2tr, btc.networks.testnet);

    // only the confirmed UTXO survives; value -> bigint; scriptPubKey derived locally
    expect(utxos).toEqual([
      {
        txid: "aa".repeat(32),
        vout: 0,
        value: 1000n,
        scriptPubKey: taprootScriptPubKeyHex(p2tr, btc.networks.testnet),
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://horizon.market/api/bitcoin/address/${p2tr}/utxos`,
    );
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
    // The private key appears nowhere in the request.
    expect(JSON.stringify(calls)).not.toContain(TEST_KEY);
  });
});

describe("resolveKontorFunding (per-submission leases)", () => {
  const p2tr = new LocalSigner(TEST_KEY, "testnet").getAddresses().p2tr!;
  const script = taprootScriptPubKeyHex(p2tr, btc.networks.testnet);
  const unusedHttp = {} as unknown as HttpClient;
  const utxo = (byte: string, value: number) => ({
    txid: byte.repeat(32),
    vout: 0,
    value,
  });

  it("leases a static list single-flight, and chains its change once settled", async () => {
    const funding = resolveKontorFunding(unusedHttp, p2tr, btc.networks.testnet, [
      utxo("aa", 1000),
    ]);

    const lease = await funding.reserve();
    // The scriptPubKey is derived from the address the list was given for.
    expect(lease.utxos).toEqual([
      { txid: "aa".repeat(32), vout: 0, value: 1000n, scriptPubKey: script },
    ]);
    // A second submission cannot take the same coins while the first is open.
    await expect(funding.reserve()).rejects.toThrow(/prior submission unresolved/);

    const change = { txid: "cc".repeat(32), vout: 1, value: 400n, scriptPubKey: script };
    lease.settle({ spent: [...lease.utxos], change: [change] });
    // Only the verified change is left to fund the next submission.
    await expect(funding.reserve()).resolves.toMatchObject({ utxos: [change] });
  });

  it("re-queries a fetcher per lease, never handing out a reserved or spent outpoint", async () => {
    let snapshot = [utxo("aa", 1000), utxo("bb", 2000)];
    const fetcher = vi.fn(async () => snapshot);
    const funding = resolveKontorFunding(
      unusedHttp,
      p2tr,
      btc.networks.testnet,
      fetcher,
    );

    const first = await funding.reserve();
    first.retain([first.utxos[0]!]); // the signed package used only `aa`
    const second = await funding.reserve();

    expect(fetcher).toHaveBeenCalledTimes(2);
    // `aa` is reserved by the open lease; the unused `bb` went back to the pool.
    expect(second.utxos.map((u) => u.txid)).toEqual(["bb".repeat(32)]);
    second.release();

    first.settle({ spent: [...first.utxos], change: [] });
    // The wallet's snapshot may still list `aa` (the spend is unconfirmed):
    // a settled spend is retired from this source, not offered again.
    snapshot = [utxo("aa", 1000), utxo("bb", 2000)];
    const third = await funding.reserve();
    expect(third.utxos.map((u) => u.txid)).toEqual(["bb".repeat(32)]);
  });

  it("auto-fetches the address's confirmed UTXOs from Horizon on each lease", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      urls.push(String(url));
      return {
        status: 200,
        json: async () => ({
          data: [
            { ...utxo("aa", 1000), status: { confirmed: true } },
            { ...utxo("bb", 2000), status: { confirmed: false } },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const funding = resolveKontorFunding(http, p2tr, btc.networks.testnet, undefined);

    const lease = await funding.reserve();

    expect(lease.utxos.map((u) => u.txid)).toEqual(["aa".repeat(32)]);
    expect(urls).toEqual([
      `https://horizon.market/api/bitcoin/address/${p2tr}/utxos`,
    ]);
  });
});

describe("createKontorFeeQuote (fee-quotes contract)", () => {
  it("POSTs { type: 'kontor', address } to fee-quotes and maps snake_case → camelCase", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        status: 200,
        json: async () => ({
          data: {
            fee_payment_id: "fp_42",
            payment_address: "tb1pfeeaddr",
            payment_amount: 700,
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const http = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: fetchFn,
    });
    const quote = await createKontorFeeQuote(http, "tb1pselleraddr");

    expect(quote).toEqual({
      feePaymentId: "fp_42",
      paymentAddress: "tb1pfeeaddr",
      paymentAmount: 700,
      feeWaived: false,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://horizon.market/api/atomic-swaps/fee-quotes",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      type: "kontor",
      address: "tb1pselleraddr",
    });
  });

  it("maps a waived fee (credit / subscription) to feeWaived with a null address", async () => {
    const fetchFn = (async () =>
      ({
        status: 200,
        json: async () => ({
          data: {
            fee_payment_id: null,
            payment_address: null,
            payment_amount: 0,
            fee_waived: true,
          },
        }),
      }) as unknown as Response) as typeof fetch;

    const http = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: fetchFn,
    });
    const quote = await createKontorFeeQuote(http, "tb1pselleraddr");

    expect(quote).toEqual({
      feePaymentId: null,
      paymentAddress: null,
      paymentAmount: 0,
      feeWaived: true,
    });
  });
});
