import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  listSwaps,
  getSwapFacets,
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
  listing_type: "counterparty",
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
  listingType: "counterparty",
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
  imageUrl: null,
  thumbnailUrl: null,
  inscriptionNumber: null,
  assetDivisibility: null,
  kontorOfferBlob: null,
  kontorAssetKind: null,
  kontorContractAddress: null,
  kontorNftId: null,
  kontorAmount: null,
  pendingRole: null,
  pendingTxid: null,
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

  it("maps null psbt_hex for unfunded swaps", async () => {
    const wire = { ...WIRE_SWAP, psbt_hex: null, funded: false };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.psbtHex).toBeNull();
    expect(swap.funded).toBe(false);
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

  it("maps kontor_nft_id and kontor_amount for kontor listings", async () => {
    const wire = {
      ...WIRE_SWAP,
      listing_type: "kontor",
      asset_name: null,
      kontor_offer_blob: "{\"offer\":1}",
      kontor_asset_kind: "nft",
      kontor_contract_address: "nftcontract@1.2",
      kontor_nft_id: "my-nft-id",
      kontor_amount: null,
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.kontorNftId).toBe("my-nft-id");
    expect(swap.kontorAmount).toBeNull();
    expect(swap.kontorContractAddress).toBe("nftcontract@1.2");
  });

  it("maps kontor_amount for token listings", async () => {
    const wire = {
      ...WIRE_SWAP,
      listing_type: "kontor",
      kontor_asset_kind: "token",
      kontor_contract_address: "token@0.0",
      kontor_amount: "100.5",
      kontor_nft_id: null,
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.kontorAmount).toBe("100.5");
    expect(swap.kontorNftId).toBeNull();
  });

  it("defaults kontor_nft_id and kontor_amount to null when absent", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SWAP }),
    });
    const swap = await getSwap(http, "swap_abc123");
    expect(swap.kontorNftId).toBeNull();
    expect(swap.kontorAmount).toBeNull();
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
    expect(result.pagination).toEqual({ total: 1, offset: 0, limit: null });
  });

  it("maps pending_role / pending_txid when present", async () => {
    const wire = {
      count: 1,
      atomic_swaps: [
        { ...WIRE_SWAP, pending_role: "buyer", pending_txid: "deadbeef" },
      ],
      pagination: { total: 1, offset: 0, limit: null },
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const result = await listSwaps(http, { pendingAddress: "bc1qme" });
    expect(result.atomicSwaps[0].pendingRole).toBe("buyer");
    expect(result.atomicSwaps[0].pendingTxid).toBe("deadbeef");
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

  it("sends the pending_address query param", async () => {
    const fetchFn = makeFetch(200, {
      data: { count: 0, atomic_swaps: [], asset_media: {}, pagination: { total: 0, offset: 0, limit: null } },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await listSwaps(http, { pendingAddress: "bc1qme" });
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("pending_address=bc1qme");
  });

  it("sends price_min / price_max / collection query params", async () => {
    const fetchFn = makeFetch(200, {
      data: { count: 0, atomic_swaps: [], asset_media: {}, pagination: { total: 0, offset: 0, limit: null } },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await listSwaps(http, { priceMin: 1000, priceMax: 54200, collection: "rare-pepes" });
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("price_min=1000");
    expect(url).toContain("price_max=54200");
    expect(url).toContain("collection=rare-pepes");
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

describe("getSwapFacets", () => {
  const WIRE_FACETS = {
    type: { counterparty: 1034, ordinal: 250, zeld: 0, kontor: 0 },
    price: [
      { id: "any", label: "Any", min_sats: null, max_sats: null, count: 1284 },
      { id: "under_50", label: "Under $50", min_sats: null, max_sats: 54200, count: 412 },
    ],
    collection: [{ slug: "rare-pepes", name: "Rare Pepes", count: 1774 }],
  };

  it("maps wire facets (snake_case) to domain (camelCase)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_FACETS }),
    });
    const facets = await getSwapFacets(http, {});
    expect(facets.type).toEqual({ counterparty: 1034, ordinal: 250, zeld: 0, kontor: 0 });
    expect(facets.price[1]).toEqual({
      id: "under_50",
      label: "Under $50",
      minSats: null,
      maxSats: 54200,
      count: 412,
    });
    expect(facets.collection).toEqual([{ slug: "rare-pepes", name: "Rare Pepes", count: 1774 }]);
  });

  it("sends the filter params and omits pagination/sort", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_FACETS });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await getSwapFacets(http, { listingType: "ordinal", priceMax: 54200, funded: true });
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/atomic-swaps/facets?");
    expect(url).toContain("listing_type=ordinal");
    expect(url).toContain("price_max=54200");
    expect(url).toContain("funded=true");
    expect(url).not.toContain("offset");
    expect(url).not.toContain("order_by");
  });

  it("hits the bare facets path when no filters are set", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_FACETS });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await getSwapFacets(http, {});
    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/api/atomic-swaps/facets");
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
        zeldSendTxId: "abc123",
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
      { tx_id: "txid_1", buyer_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", atomic_swap: { id: "swap_abc" } },
    ];
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wireSales }),
    });
    const sales = await purchaseSwaps(http, {
      swapIds: ["swap_abc"],
      buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      psbtHex: "70736274ff",
    });
    expect(sales).toEqual([
      { txId: "txid_1", buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", atomicSwap: { id: "swap_abc" } },
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
    const result = await getPendingPurchaseTxIds(http, "swap_abc", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(result).toEqual(txIds);
  });
});
