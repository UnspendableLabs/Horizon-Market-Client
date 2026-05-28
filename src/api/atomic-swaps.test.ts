import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  listSwaps,
  getSwap,
  createSwap,
  purchaseSwaps,
  getLockedAssetUtxoIds,
  searchAssetNames,
  getPendingPurchaseTxIds,
} from "./atomic-swaps.js";
import { makeFetch } from "../test-utils.js";

const WIRE_SWAP = {
  id: "swap_abc123",
  listing_type: "xcp",
  seller_address: "bc1qseller",
  buyer_address: null,
  asset_utxo_id: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234:0",
  asset_utxo_value: 600,
  asset_name: "RAREPEPE",
  asset_quantity: "1",
  price: 250000,
  price_per_unit: 250000,
  psbt_hex: "70736274ff",
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
};

const DOMAIN_SWAP = {
  id: "swap_abc123",
  listingType: "xcp",
  sellerAddress: "bc1qseller",
  buyerAddress: null,
  assetUtxoId: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234:0",
  assetUtxoValue: 600,
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  price: 250000,
  pricePerUnit: 250000,
  psbtHex: "70736274ff",
  txId: null,
  blockIndex: null,
  funded: true,
  filled: false,
  confirmed: true,
  delisted: false,
  sellerDelisted: false,
  expired: false,
  pending: false,
  anomalous: false,
  royalty: null,
  expiresAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  onChainPayment: null,
};

describe("getSwap", () => {
  it("maps wire swap to domain type", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SWAP }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap).toEqual(DOMAIN_SWAP);
  });

  it("converts asset_quantity string to bigint", async () => {
    const wire = { ...WIRE_SWAP, asset_quantity: "9007199254740993" };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.assetQuantity).toBe(9007199254740993n);
  });

  it("converts asset_quantity number to bigint", async () => {
    const wire = { ...WIRE_SWAP, asset_quantity: 42 };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.assetQuantity).toBe(42n);
  });

  it("handles null asset_quantity", async () => {
    const wire = { ...WIRE_SWAP, asset_quantity: null };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.assetQuantity).toBeNull();
  });

  it("maps user when present", async () => {
    const wire = { ...WIRE_SWAP, user: { id: "user_abc" } };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.user).toEqual({ id: "user_abc" });
  });

  it("maps on_chain_payment correctly", async () => {
    const wire = {
      ...WIRE_SWAP,
      on_chain_payment: {
        id: "ocp_1",
        confirmed: false,
        txid: null,
        sats: 5000,
        to_address: "bc1qfee",
      },
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.onChainPayment).toEqual({
      id: "ocp_1",
      confirmed: false,
      txid: null,
      sats: 5000,
      toAddress: "bc1qfee",
    });
  });
});

describe("listSwaps", () => {
  it("maps wire list response to domain type", async () => {
    const wire = {
      count: 1,
      atomic_swaps: [WIRE_SWAP],
      asset_media: { RAREPEPE: { url: "https://example.com/img.png" } },
      pagination: { total: 1, offset: 0, limit: null },
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const result = await listSwaps(http, {});
    expect(result.count).toBe(1);
    expect(result.atomicSwaps).toHaveLength(1);
    expect(result.atomicSwaps[0]).toEqual(DOMAIN_SWAP);
    expect(result.assetMedia).toEqual({ RAREPEPE: { url: "https://example.com/img.png" } });
    expect(result.pagination).toEqual({ total: 1, offset: 0, limit: null });
  });

  it("sends correct query params for boolean filters", async () => {
    const fetchFn = makeFetch(200, {
      data: { count: 0, atomic_swaps: [], asset_media: {}, pagination: { total: 0, offset: 0, limit: 10 } },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await listSwaps(http, { funded: true, delisted: false, limit: 10, offset: 5 });
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("funded=true");
    expect(url).toContain("delisted=false");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
  });

  it("omits unset params", async () => {
    const fetchFn = makeFetch(200, {
      data: { count: 0, atomic_swaps: [], asset_media: {}, pagination: { total: 0, offset: 0, limit: null } },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await listSwaps(http, {});
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/atomic-swaps");
  });

  it("forwards AbortSignal to fetch", async () => {
    const fetchFn = makeFetch(200, {
      data: { count: 0, atomic_swaps: [], asset_media: {}, pagination: { total: 0, offset: 0, limit: null } },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    const controller = new AbortController();
    await listSwaps(http, {}, { signal: controller.signal });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBe(controller.signal);
  });
});

describe("createSwap", () => {
  it("returns created: true on 201", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(201, { data: WIRE_SWAP }),
    });
    const result = await createSwap(http, {
      assetUtxoId: "abcd:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
    });
    expect(result.status).toBe(201);
    expect(result.created).toBe(true);
    expect(result.swap).toEqual(DOMAIN_SWAP);
  });

  it("returns created: false on 200 (ZELD idempotent replay)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SWAP }),
    });
    const result = await createSwap(http, {
      assetUtxoId: "abcd:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
    });
    expect(result.status).toBe(200);
    expect(result.created).toBe(false);
  });

  it("serializes fee_payment in body", async () => {
    const fetchFn = makeFetch(201, { data: WIRE_SWAP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await createSwap(http, {
      assetUtxoId: "abcd:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
      feePayment: { psbtHex: "feepsbt", feePaymentId: "fp_1" },
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.fee_payment).toEqual({ psbt_hex: "feepsbt", fee_payment_id: "fp_1" });
  });

  it("throws HorizonMarketApiError on 409 Conflicting zeld listing", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(409, { error: "Conflicting zeld listing" }),
    });
    await expect(
      createSwap(http, {
        assetUtxoId: "zeldutxo:0",
        assetUtxoValue: 600,
        price: 250_000,
        sellerAddress: "bc1qseller",
        psbtHex: "70736274ff",
        listingType: "zeld",
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
      }),
    ).rejects.toMatchObject({
      status: 409,
      error: "Conflicting zeld listing",
    });
    await expect(
      createSwap(http, {
        assetUtxoId: "zeldutxo:0",
        assetUtxoValue: 600,
        price: 250_000,
        sellerAddress: "bc1qseller",
        psbtHex: "70736274ff",
        listingType: "zeld",
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
      }),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
  });

  it("serializes zeld_payment in body", async () => {
    const fetchFn = makeFetch(201, { data: WIRE_SWAP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await createSwap(http, {
      assetUtxoId: "zeldpreptxid:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: 100_000_000n,
      zeldPayment: {
        zeldSendTxid: "abc123",
        zeldSendTxHex: "02000000",
        feePaymentId: "fp_1",
      },
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.zeld_payment).toEqual({
      zeld_send_txid: "abc123",
      zeld_send_tx_hex: "02000000",
      fee_payment_id: "fp_1",
    });
  });

  it("serializes funding_tx_hex and reveal_tx_hex in body", async () => {
    const fetchFn = makeFetch(201, { data: WIRE_SWAP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await createSwap(http, {
      assetUtxoId: "revealthash:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
      fundingTxHex: "02000000commit",
      revealTxHex: "02000000reveal",
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.funding_tx_hex).toBe("02000000commit");
    expect(body.reveal_tx_hex).toBe("02000000reveal");
  });

  it("serializes large asset_quantity as string", async () => {
    const fetchFn = makeFetch(201, { data: WIRE_SWAP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    const bigQty = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await createSwap(http, {
      assetUtxoId: "abcd:0",
      assetUtxoValue: 600,
      price: 250000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
      assetQuantity: bigQty,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.asset_quantity).toBe(bigQty.toString());
  });
});

describe("purchaseSwaps", () => {
  it("maps wire pending sales to domain type", async () => {
    const wireSales = [
      { tx_id: "txid_1", buyer_address: "bc1qbuyer", atomic_swap: { id: "swap_abc" } },
    ];
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wireSales }),
    });
    const sales = await purchaseSwaps(http, {
      swapIds: ["swap_abc"],
      buyerAddress: "bc1qbuyer",
      psbtHex: "70736274ff",
    });
    expect(sales).toEqual([
      { txId: "txid_1", buyerAddress: "bc1qbuyer", atomicSwap: { id: "swap_abc" } },
    ]);
  });
});

describe("getLockedAssetUtxoIds", () => {
  it("returns the unwrapped record", async () => {
    const locked = { "txid1:0": true, "txid2:1": true };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: locked }),
    });
    const result = await getLockedAssetUtxoIds(http, { sellerAddress: "bc1qseller" });
    expect(result).toEqual(locked);
  });

  it("sends sellerAddresses as comma-separated string", async () => {
    const fetchFn = makeFetch(200, { data: {} });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await getLockedAssetUtxoIds(http, { sellerAddresses: ["bc1qa", "bc1qb"] });
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("seller_addresses=bc1qa%2Cbc1qb");
  });
});

describe("searchAssetNames", () => {
  it("maps wire response to domain type", async () => {
    const wire = {
      asset_names: ["RAREPEPE", "BADCAT"],
      asset_media: { RAREPEPE: { url: "https://example.com" } },
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const result = await searchAssetNames(http, { query: "RARE" });
    expect(result.assetNames).toEqual(["RAREPEPE", "BADCAT"]);
    expect(result.assetMedia).toEqual({ RAREPEPE: { url: "https://example.com" } });
  });
});

describe("getPendingPurchaseTxIds", () => {
  it("returns string array of tx ids", async () => {
    const txIds = ["txid_abc", "txid_def"];
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: txIds }),
    });
    const result = await getPendingPurchaseTxIds(http, "swap_abc", "bc1qbuyer");
    expect(result).toEqual(txIds);
  });
});
