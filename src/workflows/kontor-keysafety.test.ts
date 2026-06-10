import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the entire Kontor SDK so the offer/accept/revoke flows never touch a
// network or a real signer. The mock records the private key handed to
// LocalKey.fromPrivateKey on a global so we can assert the key was used LOCALLY
// (in-process signing) while never appearing in any HTTP request body.
vi.mock("@kontor/sdk", () => {
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
  const MOCK_BLOB = JSON.stringify({ v: 1, attachReveal: RAW_TX_HEX });

  class Wit {
    constructor(_src: string) {}
  }
  class ContractBase {}
  class HttpTransport {
    constructor(_opts: unknown) {}
  }
  class ContractAddress {
    constructor(
      public name: string,
      public height: bigint,
      public txIndex: bigint,
    ) {}
    toString() {
      return `${this.name}@${this.height}.${this.txIndex}`;
    }
  }
  const signet = {
    name: "signet",
    contracts: { nativeToken: { name: "token", height: 0n, txIndex: 0n } },
  };
  const Decimal = { from: (v: string) => ({ __decimal: v }) };
  const HolderRef = { fromRaw: () => ({}) };
  class Attachment {}
  const LocalKey = {
    fromPrivateKey: (opts: { privateKey: string; chain: unknown }) => {
      (globalThis as Record<string, unknown>).__kontorReceivedKey =
        opts.privateKey;
      return { identity: { address: "tb1pmockidentityaddress" } };
    },
  };
  const inMemoryFunding = (utxos: unknown[]) => ({ kind: "inmem", utxos });
  const queryFunding = (fetch: () => Promise<unknown[]>) => ({
    kind: "query",
    fetch,
  });

  class KontorSession {
    chain: unknown;
    identity: { address: string };
    constructor(opts: {
      chain: unknown;
      signing?: { identity: { address: string } };
    }) {
      this.chain = opts.chain;
      this.identity = opts.signing?.identity ?? { address: "tb1preadonly" };
    }
    bind() {
      return {
        attachment: () => ({
          offer: async () => ({ serialize: () => MOCK_BLOB }),
        }),
      };
    }
    openOffer() {
      return {
        inspect: async () => ({ valid: true }),
        accept: async () => ({ txid: "ab".repeat(32) }),
      };
    }
    close() {}
  }
  class Offer {
    constructor(_s: unknown, _d: unknown) {}
    async revoke() {
      return { txid: "cd".repeat(32) };
    }
  }

  return {
    Wit,
    ContractBase,
    HttpTransport,
    ContractAddress,
    signet,
    Decimal,
    HolderRef,
    Attachment,
    LocalKey,
    inMemoryFunding,
    queryFunding,
    KontorSession,
    Offer,
  };
});

import { HorizonMarketClient } from "../client.js";
import { LocalSigner } from "../crypto/signer.js";

const TEST_KEY =
  "0202020202020202020202020202020202020202020202020202020202020202";

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
const KONTOR_OFFER_BLOB = JSON.stringify({ v: 1, attachReveal: RAW_TX_HEX });

const SELLER_P2TR = new LocalSigner(TEST_KEY, "testnet").getAddresses().p2tr!;

interface RecordedCall {
  url: string;
  method: string;
  body?: string;
}

function wireSwap(overrides: Record<string, unknown> = {}) {
  return {
    id: "swap1",
    listing_type: "kontor",
    seller_address: SELLER_P2TR,
    buyer_address: null,
    asset_utxo_id: "x:0",
    asset_utxo_value: 0,
    asset_name: null,
    asset_quantity: null,
    price: 50000,
    price_per_unit: null,
    psbt_hex: null,
    tx_id: null,
    block_index: null,
    funded: true,
    filled: false,
    confirmed: true,
    delisted: false,
    seller_delisted: false,
    expired: false,
    pending: false,
    anomalous: false,
    royalty: null,
    expires_at: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    on_chain_payment: null,
    kontor_offer_blob: KONTOR_OFFER_BLOB,
    kontor_asset_kind: "token",
    kontor_contract_address: "token@0.0",
    ...overrides,
  };
}

function makeClient(calls: RecordedCall[]) {
  const json = (data: unknown, status = 200) =>
    ({ status, json: async () => ({ data }) }) as unknown as Response;

  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url: u, method, body });

    if (u.endsWith("/api/atomic-swaps/fee-quotes") && method === "POST") {
      return json({
        fee_payment_id: "fp_1",
        payment_address: "tb1qfeeaddr",
        payment_amount: 700,
      });
    }
    if (u.endsWith("/api/atomic-swaps") && method === "POST") {
      return json(wireSwap(), 201);
    }
    if (/\/api\/atomic-swaps\/[^/]+\/kontor-buy$/.test(u) && method === "POST") {
      return json({ ok: true });
    }
    if (
      /\/api\/atomic-swaps\/[^/]+\/delist-requests$/.test(u) &&
      method === "POST"
    ) {
      return json({
        id: "dr_1",
        atomic_swap: { id: "swap1", seller_address: SELLER_P2TR },
      });
    }
    if (/\/delist-requests\/[^/]+$/.test(u) && method === "PUT") {
      return json({ id: "dr_1", signature: "sig" });
    }
    if (/\/api\/atomic-swaps\/[^/]+$/.test(u) && method === "GET") {
      return json(wireSwap());
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  }) as typeof fetch;

  return new HorizonMarketClient({
    privateKey: TEST_KEY,
    network: "testnet",
    kontorNetwork: "signet",
    baseUrl: "https://horizon.market",
    fetch: fetchFn,
  });
}

/** Assert the private key was used locally but never appears in any request. */
function assertKeySafety(calls: RecordedCall[]) {
  expect((globalThis as Record<string, unknown>).__kontorReceivedKey).toBe(
    TEST_KEY,
  );
  for (const call of calls) {
    expect(call.url).not.toContain(TEST_KEY);
    expect(call.body ?? "").not.toContain(TEST_KEY);
  }
}

describe("Kontor key safety (private key never leaves the client)", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__kontorReceivedKey;
  });

  it("openSellOrder (token) sends no key, fee quote and create are key-free", async () => {
    const calls: RecordedCall[] = [];
    const client = makeClient(calls);

    const { created } = await client.openSellOrder({
      listingType: "kontor",
      kontorAssetKind: "token",
      korAmount: "100",
      priceSats: 50000,
    });

    expect(created).toBe(true);
    assertKeySafety(calls);

    const feeQuote = calls.find((c) =>
      c.url.endsWith("/api/atomic-swaps/fee-quotes"),
    )!;
    expect(JSON.parse(feeQuote.body!)).toEqual({
      type: "kontor",
      address: SELLER_P2TR,
    });

    const create = calls.find(
      (c) => c.url.endsWith("/api/atomic-swaps") && c.method === "POST",
    )!;
    const createBody = JSON.parse(create.body!);
    expect(createBody.listing_type).toBe("kontor");
    expect(createBody.kontor_offer_blob).toBe(KONTOR_OFFER_BLOB);
    expect(createBody.kontor_asset_kind).toBe("token");
    expect(createBody.fee_payment).toEqual({ fee_payment_id: "fp_1" });
    expect("psbt_hex" in createBody).toBe(false);
  });

  it("openSellOrder (nft) sends the nft contract + id, no key", async () => {
    const calls: RecordedCall[] = [];
    const client = makeClient(calls);

    await client.openSellOrder({
      listingType: "kontor",
      kontorAssetKind: "nft",
      nftId: "nft-7",
      nftContractAddress: "nft@307992.5",
      priceSats: 99000,
    });

    assertKeySafety(calls);
    const create = calls.find(
      (c) => c.url.endsWith("/api/atomic-swaps") && c.method === "POST",
    )!;
    const body = JSON.parse(create.body!);
    expect(body.kontor_asset_kind).toBe("nft");
    expect(body.kontor_nft_id).toBe("nft-7");
    expect(body.kontor_contract_address).toBe("nft@307992.5");
  });

  it("fillSwaps (kontor) records buyer_address + tx_id, no key", async () => {
    const calls: RecordedCall[] = [];
    const client = makeClient(calls);

    const sales = await client.fillSwaps({ swapIds: ["swap1"] });

    expect(sales).toHaveLength(1);
    expect(sales[0].txId).toBe("ab".repeat(32));
    assertKeySafety(calls);

    const buy = calls.find((c) => c.url.endsWith("/kontor-buy"))!;
    expect(JSON.parse(buy.body!)).toEqual({
      buyer_address: "tb1pmockidentityaddress",
      tx_id: "ab".repeat(32),
    });
  });

  it("delistSwap (kontor) revokes then BIP322-confirms, no key", async () => {
    const calls: RecordedCall[] = [];
    const client = makeClient(calls);

    await client.delistSwap("swap1");

    assertKeySafety(calls);
    expect(calls.some((c) => c.url.endsWith("/delist-requests"))).toBe(true);
    expect(
      calls.some((c) => /\/delist-requests\/[^/]+$/.test(c.url) && c.method === "PUT"),
    ).toBe(true);
  });
});

describe("Kontor dispatch gating", () => {
  it("throws when kontorNetwork is not configured", () => {
    const client = new HorizonMarketClient({
      privateKey: TEST_KEY,
      network: "testnet",
    });
    expect(() =>
      client.openSellOrder({
        listingType: "kontor",
        kontorAssetKind: "token",
        korAmount: "1",
        priceSats: 1000,
      }),
    ).toThrow(/signet/);
  });

  it("throws when the client network is not testnet", () => {
    const client = new HorizonMarketClient({
      privateKey: TEST_KEY,
      network: "mainnet",
      kontorNetwork: "signet",
    });
    expect(() =>
      client.openSellOrder({
        listingType: "kontor",
        kontorAssetKind: "token",
        korAmount: "1",
        priceSats: 1000,
      }),
    ).toThrow(/testnet/);
  });
});
