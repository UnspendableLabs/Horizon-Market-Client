import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Heavy / dynamically-imported modules are mocked so the client's dispatch
// logic is exercised without loading @kontor/sdk or running real workflows. ────
vi.mock("./workflows/sell.js", () => ({ openSellOrder: vi.fn() }));
vi.mock("./workflows/buy.js", () => ({ fillSwaps: vi.fn() }));
vi.mock("./workflows/delist.js", () => ({ delistSwap: vi.fn() }));
vi.mock("./send/index.js", () => ({ prepareSend: vi.fn(), sendAsset: vi.fn() }));
vi.mock("./workflows/sell-kontor.js", () => ({ openKontorSellOrder: vi.fn() }));
vi.mock("./workflows/buy-kontor.js", () => ({ fillKontorSwap: vi.fn() }));
vi.mock("./workflows/delist-kontor.js", () => ({ delistKontorSwap: vi.fn() }));
vi.mock("./kontor/chain.js", () => ({
  resolveKontorChain: vi.fn((net?: string) =>
    net === "signet" ? { network: "signet" } : null,
  ),
}));
vi.mock("./kontor/session.js", () => ({
  makeKontorReadSession: vi.fn(() => ({
    identity: { xOnlyPubKey: "sessionXOnly" },
    close: vi.fn(),
  })),
}));
vi.mock("./kontor/contracts.js", () => ({
  bindKontorToken: vi.fn(() => ({
    // 0n is falsy → skipped by the `!raw` guard; holderB's 5n is the found balance.
    balance: vi.fn(async (holder: string) => (holder === "holderB" ? 5n : 0n)),
  })),
  bindKontorNft: vi.fn(() => ({
    countNftsByHolder: vi.fn(async (holder: string) =>
      holder === "holderB" ? 2n : 0n,
    ),
    listNftsByHolder: vi.fn(async () => [{ nftId: "n1" }, { nftId: "n2" }]),
  })),
}));
vi.mock("./kontor/holders.js", () => ({
  holderCandidates: vi.fn(() => ["holderA", "holderB"]),
}));

import { HorizonMarketClient } from "./client.js";
import {
  makeFetch,
  makeSequentialFetch,
  makeFetchResponses,
  mockResponse,
  makeSigner,
  TEST_PRIVATE_KEY_HEX,
  TEST_P2WPKH_ADDRESS,
} from "./test-utils.js";
import { openSellOrder as workflowOpenSellOrder } from "./workflows/sell.js";
import { fillSwaps as workflowFillSwaps } from "./workflows/buy.js";
import { delistSwap as workflowDelistSwap } from "./workflows/delist.js";
import { prepareSend as sendPrepareSend, sendAsset } from "./send/index.js";
import { openKontorSellOrder } from "./workflows/sell-kontor.js";
import { fillKontorSwap } from "./workflows/buy-kontor.js";
import { delistKontorSwap } from "./workflows/delist-kontor.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Wire fixtures ─────────────────────────────────────────────────────────────

function wireSwap(listing_type: string) {
  return {
    id: "swap_1",
    listing_type,
    seller_address: "bc1qseller",
    buyer_address: null,
    asset_utxo_id: "utxo:0",
    asset_utxo_value: 600,
    asset_name: "ASSET",
    asset_quantity: null,
    price: 1000,
    price_per_unit: null,
    psbt_hex: null,
    tx_id: null,
    block_index: null,
    funded: true,
    filled: false,
    confirmed: false,
    delisted: false,
    seller_delisted: false,
    expired: false,
    pending: false,
    anomalous: false,
    royalty: null,
    expires_at: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    on_chain_payment: null,
  };
}

const SELL_QUOTE_DATA = {
  swap_psbt: "70736274ff",
  swap_inputs_to_sign: [0],
  fee_psbt: null,
  fee_inputs_to_sign: [],
  fee_payment_id: "fp_1",
  fee_waived: false,
  asset_utxo_id: "utxo:0",
  asset_utxo_value: 600,
  prep_psbt: null,
  prep_inputs_to_sign: [],
  prep_kind: null,
};

// ─── Constructor / option handling ────────────────────────────────────────────

describe("HorizonMarketClient constructor options", () => {
  it("throws 'requires authentication' when no signer is configured", async () => {
    const client = new HorizonMarketClient({ network: "mainnet" });
    await expect(
      client.signInWithWallet(),
    ).rejects.toThrow("requires authentication");
  });

  it("builds a LocalSigner from a privateKey (used for getAddresses)", async () => {
    const fetchFn = makeFetch(200, { data: SELL_QUOTE_DATA });
    const client = new HorizonMarketClient({
      privateKey: TEST_PRIVATE_KEY_HEX,
      network: "mainnet",
      fetch: fetchFn,
    });

    // A P2WPKH counterparty listing signs nothing — it only reads getAddresses().
    await client.requestSellQuote({
      price: 1000,
      sellerAddress: TEST_P2WPKH_ADDRESS,
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
      assetUtxoId: "utxo:0",
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it("honours mnemonicOptions when deriving from a mnemonic", () => {
    const client = new HorizonMarketClient({
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      mnemonicOptions: { account: 0, passphrase: "" },
      network: "mainnet",
    });
    expect(client).toBeInstanceOf(HorizonMarketClient);
    expect(client.isAuthenticated).toBe(false);
  });

  it("marks the client authenticated when a bearerToken is supplied", () => {
    const client = new HorizonMarketClient({ bearerToken: "tok_abc" });
    expect(client.isAuthenticated).toBe(true);
  });

  it("marks the client authenticated when a sessionToken is supplied", () => {
    const client = new HorizonMarketClient({ sessionToken: "sess_abc" });
    expect(client.isAuthenticated).toBe(true);
  });
});

// ─── Authentication ───────────────────────────────────────────────────────────

describe("HorizonMarketClient authentication", () => {
  it("signInWithWallet stores a bearer token and returns the balance", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: { nonce: "n1", message: "sign-me" } } },
      {
        status: 200,
        body: { data: { token: "tok_123", credits: 5, free_credits: 3 } },
      },
    );
    const signer = makeSigner({ p2tr: "bc1ptaproot" });
    const client = new HorizonMarketClient({ signer, fetch: fetchFn });

    const result = await client.signInWithWallet();

    expect(result).toEqual({ token: "tok_123", credits: 5, freeCredits: 3 });
    expect(client.isAuthenticated).toBe(true);
    expect(signer.signMessage).toHaveBeenCalledWith("bc1qseller", "sign-me");
  });

  it("signInWithWallet honours explicit address / taprootAddress / walletProvider", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: { nonce: "n2", message: "msg2" } } },
      {
        status: 200,
        body: { data: { token: "tok_x", credits: 0, free_credits: 0 } },
      },
    );
    const signer = makeSigner();
    const client = new HorizonMarketClient({ signer, fetch: fetchFn });

    await client.signInWithWallet({
      address: "bc1qcustom",
      taprootAddress: "bc1pcustom",
      walletProvider: "my-wallet",
    });

    // The token POST carries the explicit address + provider.
    const tokenCall = (fetchFn.mock.calls[1] ?? []) as [string, RequestInit];
    const body = JSON.parse(tokenCall[1].body as string);
    expect(body.address).toBe("bc1qcustom");
    expect(body.wallet_provider).toBe("my-wallet");
    expect(body.taproot_address).toBe("bc1pcustom");
  });

  it("signInWithWalletCookie establishes a session cookie", async () => {
    const fetchFn = makeFetchResponses(
      mockResponse(200, { data: { nonce: "n1", message: "sign-me" } }),
      mockResponse(200, { csrfToken: "csrf_1" }),
      mockResponse(200, {}, ["authjs.session-token=sess_abc; Path=/; HttpOnly"]),
    );
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      fetch: fetchFn,
    });

    await client.signInWithWalletCookie();
    expect(client.isAuthenticated).toBe(true);
  });

  it("getCredits returns the parsed balance when authenticated", async () => {
    const fetchFn = makeFetch(200, {
      data: { credits: 7, free_credits: 2 },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.getCredits()).resolves.toEqual({
      credits: 7,
      freeCredits: 2,
    });
  });

  it("getCredits returns null when signed out (401)", async () => {
    const fetchFn = makeFetch(401, {});
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.getCredits()).resolves.toBeNull();
  });

  it("getSession returns the session when authenticated", async () => {
    const fetchFn = makeFetch(200, {
      user: { id: "u1", address: "bc1qseller", email: "a@b.c" },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.getSession()).resolves.toEqual({
      id: "u1",
      address: "bc1qseller",
      email: "a@b.c",
    });
  });

  it("getSession returns null when signed out (401)", async () => {
    const fetchFn = makeFetch(401, {});
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.getSession()).resolves.toBeNull();
  });

  it("signOut clears the stored bearer token", () => {
    const client = new HorizonMarketClient({ bearerToken: "tok_abc" });
    expect(client.isAuthenticated).toBe(true);
    client.signOut();
    expect(client.isAuthenticated).toBe(false);
  });
});

// ─── REST helpers ─────────────────────────────────────────────────────────────

describe("HorizonMarketClient REST helpers", () => {
  it("listSwaps maps the wire result", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        count: 1,
        atomic_swaps: [wireSwap("ordinal")],
        pagination: { total: 1, offset: 0, limit: null },
      },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const res = await client.listSwaps({ assetName: "ASSET", limit: 10 });
    expect(res.count).toBe(1);
    expect(res.atomicSwaps).toHaveLength(1);
    expect(res.atomicSwaps[0].id).toBe("swap_1");
  });

  it("getSwap maps a single swap", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("counterparty") });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const swap = await client.getSwap("swap_1");
    expect(swap.listingType).toBe("counterparty");
  });

  it("getLockedAssetUtxoIds passes params through", async () => {
    const fetchFn = makeFetch(200, { data: { assetUtxoIds: ["utxo:0"] } });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(
      client.getLockedAssetUtxoIds({ sellerAddress: "bc1qseller" }),
    ).resolves.toEqual({ assetUtxoIds: ["utxo:0"] });
  });

  it("getLockedAssetUtxoIds works with no params", async () => {
    const fetchFn = makeFetch(200, { data: { assetUtxoIds: [] } });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.getLockedAssetUtxoIds()).resolves.toEqual({
      assetUtxoIds: [],
    });
  });

  it("searchAssetNames maps the wire result", async () => {
    const fetchFn = makeFetch(200, {
      data: { asset_names: ["PEPE"], asset_media: { PEPE: {} } },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const res = await client.searchAssetNames({ query: "PEP", limit: 5 });
    expect(res.assetNames).toEqual(["PEPE"]);
  });

  it("getPendingPurchaseTxIds returns the tx id array", async () => {
    const fetchFn = makeFetch(200, { data: ["tx_1", "tx_2"] });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(
      client.getPendingPurchaseTxIds("swap_1", "bc1qbuyer"),
    ).resolves.toEqual(["tx_1", "tx_2"]);
  });

  it("previewKontorListingFee maps sats + feeWaived", async () => {
    const fetchFn = makeFetch(200, {
      data: { payment_amount: 5000, fee_waived: false },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(
      client.previewKontorListingFee("bc1ptaproot"),
    ).resolves.toEqual({ sats: 5000, feeWaived: false });
  });

  it("requestBuyQuote returns the mapped quote on the happy path", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        psbt: "70736274ff",
        inputs_to_sign: [0],
        fee_estimate_sats: 250,
        royalty_sats: 0,
        royalty_address: null,
      },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const quote = await client.requestBuyQuote({
      swapIds: ["swap_1"],
      buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    });
    expect(quote.psbt).toBe("70736274ff");
    expect(quote.feeEstimateSats).toBe(250);
  });

  it("requestFeeQuote returns a BTC fee quote (non-zeld path)", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        fee_payment_id: "fp_1",
        psbt: "70736274ff",
        raw_transaction: "abcd",
        inputs_to_sign: [0],
      },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const quote = await client.requestFeeQuote({
      address: "bc1qseller",
      utxoSetIds: ["utxo:0"],
      satsPerVbyte: 5,
    });
    expect(quote).toEqual({
      feePaymentId: "fp_1",
      psbt: "70736274ff",
      rawTransaction: "abcd",
      inputsToSign: [0],
    });
  });

  it("createSwap returns created:true on HTTP 201", async () => {
    const fetchFn = makeFetch(201, { data: wireSwap("counterparty") });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const res = await client.createSwap({
      assetUtxoId: "utxo:0",
      assetUtxoValue: 600,
      price: 1000,
      sellerAddress: "bc1qseller",
      psbtHex: "70736274ff",
    });
    expect(res.created).toBe(true);
    expect(res.status).toBe(201);
    expect(res.swap.id).toBe("swap_1");
  });

  it("purchaseSwaps maps pending sales on the happy path", async () => {
    const fetchFn = makeFetch(200, {
      data: [
        {
          tx_id: "tx_1",
          buyer_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          atomic_swap: { id: "swap_1" },
        },
      ],
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    const res = await client.purchaseSwaps({
      swapIds: ["swap_1"],
      buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      psbtHex: "70736274ff",
    });
    expect(res).toEqual([
      {
        txId: "tx_1",
        buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        atomicSwap: { id: "swap_1" },
      },
    ]);
  });

  it("startDelist maps the delist request", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        id: "delist_1",
        atomic_swap: { id: "swap_1", seller_address: "bc1qseller" },
      },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(client.startDelist("swap_1")).resolves.toEqual({
      id: "delist_1",
      atomicSwap: { id: "swap_1", sellerAddress: "bc1qseller" },
    });
  });

  it("confirmDelist maps the confirm result", async () => {
    const fetchFn = makeFetch(200, {
      data: { id: "delist_1", signature: "sig==" },
    });
    const client = new HorizonMarketClient({ fetch: fetchFn });
    await expect(
      client.confirmDelist("delist_1", "sig=="),
    ).resolves.toEqual({ id: "delist_1", signature: "sig==" });
  });
});

// ─── Owned-balance reads ──────────────────────────────────────────────────────

describe("HorizonMarketClient.getCounterpartyBalances", () => {
  it("returns [] when no Counterparty base URL is configured (testnet)", async () => {
    const client = new HorizonMarketClient({ network: "testnet" });
    await expect(
      client.getCounterpartyBalances(["bc1qseller"]),
    ).resolves.toEqual([]);
  });

  it("reads balances per unique address on mainnet", async () => {
    const fetchFn = makeFetch(200, {
      result: [
        {
          asset: "XCP",
          quantity: 100,
          quantity_normalized: "0.000001",
          asset_info: { divisible: true },
        },
      ],
      next_cursor: null,
    });
    const client = new HorizonMarketClient({
      network: "mainnet",
      fetch: fetchFn,
    });
    // Duplicates and empties are collapsed to one unique address → one fetch.
    const res = await client.getCounterpartyBalances([
      "bc1qseller",
      "bc1qseller",
      "",
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].asset).toBe("XCP");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("HorizonMarketClient.getZeldBalances", () => {
  it("returns [] when no ZELD base URL is configured (testnet)", async () => {
    const client = new HorizonMarketClient({ network: "testnet" });
    await expect(client.getZeldBalances(["bc1qseller"])).resolves.toEqual([]);
  });

  it("sums ZELD utxos on mainnet", async () => {
    const fetchFn = makeFetch(200, [{ balance: 100_000_000 }]);
    const client = new HorizonMarketClient({
      network: "mainnet",
      fetch: fetchFn,
    });
    const res = await client.getZeldBalances(["bc1qseller"]);
    expect(res).toHaveLength(1);
    expect(res[0].balance).toBe(100_000_000n);
  });

  it("filters out addresses with no ZELD balance", async () => {
    const fetchFn = makeFetch(200, []);
    const client = new HorizonMarketClient({
      network: "mainnet",
      fetch: fetchFn,
    });
    await expect(client.getZeldBalances(["bc1qseller"])).resolves.toEqual([]);
  });
});

// ─── Kontor holdings ──────────────────────────────────────────────────────────

describe("HorizonMarketClient.getKontorHoldings", () => {
  it("returns empty holdings when no signer is configured", async () => {
    const client = new HorizonMarketClient({
      network: "testnet",
      kontorNetwork: "signet",
    });
    await expect(client.getKontorHoldings()).resolves.toEqual({
      kor: null,
      nfts: [],
    });
  });

  it("returns empty holdings when kontorNetwork is not set", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
    });
    await expect(client.getKontorHoldings()).resolves.toEqual({
      kor: null,
      nfts: [],
    });
  });

  it("returns empty holdings when the client network is not testnet", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner({ p2tr: "bc1ptaproot", xOnlyPubkey: "deadbeef" }),
      network: "mainnet",
      kontorNetwork: "signet",
    });
    await expect(client.getKontorHoldings()).resolves.toEqual({
      kor: null,
      nfts: [],
    });
  });

  it("returns empty holdings when the signer has no taproot key", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(), // no p2tr / xOnlyPubkey
      network: "testnet",
      kontorNetwork: "signet",
    });
    await expect(client.getKontorHoldings()).resolves.toEqual({
      kor: null,
      nfts: [],
    });
  });

  it("reads KOR balance and NFTs from the read session", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner({ p2tr: "bc1ptaproot", xOnlyPubkey: "deadbeef" }),
      network: "testnet",
      kontorNetwork: "signet",
      kontorNftContractAddress: "nftcontract@100.1",
    });
    const res = await client.getKontorHoldings();
    expect(res.kor).toEqual({ amount: "5", address: "bc1ptaproot" });
    expect(res.nfts).toEqual([
      { nftId: "n1", contractAddress: "nftcontract@100.1", address: "bc1ptaproot" },
      { nftId: "n2", contractAddress: "nftcontract@100.1", address: "bc1ptaproot" },
    ]);
  });

  it("reads KOR balance only when no NFT contract is configured", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner({ p2tr: "bc1ptaproot", xOnlyPubkey: "deadbeef" }),
      network: "testnet",
      kontorNetwork: "signet",
    });
    const res = await client.getKontorHoldings();
    expect(res.kor).toEqual({ amount: "5", address: "bc1ptaproot" });
    expect(res.nfts).toEqual([]);
  });
});

// ─── Send / withdraw ──────────────────────────────────────────────────────────

describe("HorizonMarketClient.prepareSend / send", () => {
  it("prepareSend delegates to the send composer with the built deps", async () => {
    const fakePrepared = { feeSats: 123n, broadcast: vi.fn() };
    vi.mocked(sendPrepareSend).mockResolvedValue(fakePrepared as never);
    const signer = makeSigner();
    const client = new HorizonMarketClient({ signer, network: "mainnet" });

    const request = {
      kind: "btc",
      toAddress: "bc1qdest",
      amountSats: 1000n,
      satsPerVbyte: 5,
    };
    const res = await client.prepareSend(request as never, {
      protectedUtxoIds: ["p:0"],
    });

    expect(res).toBe(fakePrepared);
    const [reqArg, depsArg] = vi.mocked(sendPrepareSend).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(reqArg).toBe(request);
    expect(depsArg.signer).toBe(signer);
    expect(depsArg.network).toBe("mainnet");
    expect(depsArg.kontorCtx).toBeUndefined();
    expect(depsArg.protectedUtxoIds).toEqual(["p:0"]);
  });

  it("send delegates to sendAsset", async () => {
    const fakeResult = { txId: "tx_broadcast" };
    vi.mocked(sendAsset).mockResolvedValue(fakeResult as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
    });
    const res = await client.send({
      kind: "btc",
      toAddress: "bc1qdest",
      amountSats: 1000n,
      satsPerVbyte: 5,
    } as never);
    expect(res).toBe(fakeResult);
  });

  it("resolves a Kontor context for kor sends", async () => {
    const fakePrepared = { feeSats: null, broadcast: vi.fn() };
    vi.mocked(sendPrepareSend).mockResolvedValue(fakePrepared as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
    });

    await client.prepareSend({
      kind: "kor",
      toAddress: "bc1pdest",
      amount: "1.5",
      satsPerVbyte: 5,
    } as never);

    const [, depsArg] = vi.mocked(sendPrepareSend).mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(depsArg.kontorCtx).toBeDefined();
  });

  it("throws 'requires authentication' when sending without a signer", async () => {
    const client = new HorizonMarketClient({ network: "mainnet" });
    await expect(
      client.prepareSend({ kind: "btc" } as never),
    ).rejects.toThrow("requires authentication");
  });
});

// ─── Workflow: openSellOrder ──────────────────────────────────────────────────

describe("HorizonMarketClient.openSellOrder", () => {
  it("delegates non-Kontor listings to the PSBT sell workflow", async () => {
    const expected = { swap: { id: "swap_1" }, created: true, transactions: [] };
    vi.mocked(workflowOpenSellOrder).mockResolvedValue(expected as never);
    const signer = makeSigner();
    const client = new HorizonMarketClient({ signer, network: "mainnet" });

    const params = {
      listingType: "ordinal",
      priceSats: 1000,
      sellerAddress: "bc1pseller",
      sellerPubkey: "aabb",
    };
    const res = await client.openSellOrder(params as never);

    expect(res).toBe(expected);
    const call = vi.mocked(workflowOpenSellOrder).mock.calls[0];
    expect(call[0]).toBe(params);
    expect(call[2]).toBe(signer);
    expect(call[3]).toBe("mainnet");
  });

  it("delegates Kontor listings to the Kontor sell workflow", async () => {
    const expected = { swap: { id: "swap_k" }, created: true, transactions: [] };
    vi.mocked(openKontorSellOrder).mockResolvedValue(expected as never);
    const signer = makeSigner();
    const client = new HorizonMarketClient({
      signer,
      network: "testnet",
      kontorNetwork: "signet",
    });

    const res = await client.openSellOrder({ listingType: "kontor" } as never);
    expect(res).toBe(expected);
    const call = vi.mocked(openKontorSellOrder).mock.calls[0];
    expect(call[2]).toBe(signer);
    // kontorCtx (4th positional) carries the resolved chain.
    expect(call[3]).toMatchObject({ chain: { network: "signet" } });
  });

  it("throws when a Kontor listing is opened without kontorNetwork", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
    });
    await expect(
      client.openSellOrder({ listingType: "kontor" } as never),
    ).rejects.toThrow("only available on signet");
  });

  it("throws when a Kontor listing is opened on a non-testnet network", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "mainnet",
      kontorNetwork: "signet",
    });
    await expect(
      client.openSellOrder({ listingType: "kontor" } as never),
    ).rejects.toThrow('network to be "testnet"');
  });
});

// ─── Workflow: fillSwaps ──────────────────────────────────────────────────────

describe("HorizonMarketClient.fillSwaps", () => {
  it("delegates directly to the buy workflow when Kontor is not configured", async () => {
    vi.mocked(workflowFillSwaps).mockResolvedValue([] as never);
    const signer = makeSigner();
    const client = new HorizonMarketClient({ signer, network: "mainnet" });

    const params = {
      swapIds: ["swap_1"],
      buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    };
    await client.fillSwaps(params as never);
    const call = vi.mocked(workflowFillSwaps).mock.calls[0];
    expect(call[0]).toBe(params);
    expect(call[2]).toBe(signer);
  });

  it("probes the swap and delegates non-Kontor swaps to the buy workflow", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("counterparty") });
    vi.mocked(workflowFillSwaps).mockResolvedValue([] as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetchFn,
    });

    await client.fillSwaps({
      swapIds: ["swap_1"],
      buyerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    } as never);
    expect(workflowFillSwaps).toHaveBeenCalledTimes(1);
    expect(fillKontorSwap).not.toHaveBeenCalled();
  });

  it("delegates a single Kontor swap to the Kontor buy workflow", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("kontor") });
    const pending = [
      { txId: "tx_1", buyerAddress: "bc1qbuyer", atomicSwap: { id: "swap_1" } },
    ];
    vi.mocked(fillKontorSwap).mockResolvedValue(pending as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetchFn,
    });

    const res = await client.fillSwaps({ swapIds: ["swap_1"] } as never);
    expect(res).toBe(pending);
    expect(fillKontorSwap).toHaveBeenCalledTimes(1);
  });

  it("throws when a Kontor purchase targets more than one swap", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("kontor") });
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetchFn,
    });
    await expect(
      client.fillSwaps({ swapIds: ["swap_1", "swap_2"] } as never),
    ).rejects.toThrow("exactly one swapId");
  });

  it("throws when swapIds is empty and Kontor is configured", async () => {
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
    });
    await expect(
      client.fillSwaps({ swapIds: [] } as never),
    ).rejects.toThrow("At least one swapId is required");
  });
});

// ─── Workflow: delistSwap ─────────────────────────────────────────────────────

describe("HorizonMarketClient.delistSwap", () => {
  it("delegates directly to the delist workflow when Kontor is not configured", async () => {
    vi.mocked(workflowDelistSwap).mockResolvedValue(undefined as never);
    const signer = makeSigner();
    const client = new HorizonMarketClient({ signer, network: "mainnet" });

    await client.delistSwap("swap_1");
    const call = vi.mocked(workflowDelistSwap).mock.calls[0];
    expect(call[0]).toBe("swap_1");
    expect(call[2]).toBe(signer);
  });

  it("delegates a Kontor swap to the Kontor delist workflow", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("kontor") });
    vi.mocked(delistKontorSwap).mockResolvedValue(undefined as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetchFn,
    });

    await client.delistSwap("swap_1", { fundingUtxos: undefined });
    expect(delistKontorSwap).toHaveBeenCalledTimes(1);
    expect(workflowDelistSwap).not.toHaveBeenCalled();
  });

  it("delegates a non-Kontor swap to the delist workflow even when Kontor is configured", async () => {
    const fetchFn = makeFetch(200, { data: wireSwap("ordinal") });
    vi.mocked(workflowDelistSwap).mockResolvedValue(undefined as never);
    const client = new HorizonMarketClient({
      signer: makeSigner(),
      network: "testnet",
      kontorNetwork: "signet",
      fetch: fetchFn,
    });

    await client.delistSwap("swap_1");
    expect(workflowDelistSwap).toHaveBeenCalledTimes(1);
    expect(delistKontorSwap).not.toHaveBeenCalled();
  });
});
