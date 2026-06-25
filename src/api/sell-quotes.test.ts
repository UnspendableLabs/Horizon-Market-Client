import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import { requestSellQuote } from "./sell-quotes.js";
import { makeFetch } from "../test-utils.js";

const WIRE_SELL_QUOTE_NO_PREP = {
  swap_psbt: "70736274ff_swap",
  swap_inputs_to_sign: [0],
  fee_psbt: "70736274ff_fee",
  fee_inputs_to_sign: [0],
  fee_payment_id: "fp_abc123",
  fee_waived: false,
  asset_utxo_id: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234:0",
  asset_utxo_value: 600,
  prep_psbt: null,
  prep_inputs_to_sign: [],
  prep_kind: null,
};

const WIRE_SELL_QUOTE_WITH_PREP = {
  ...WIRE_SELL_QUOTE_NO_PREP,
  prep_psbt: "70736274ff_prep",
  prep_inputs_to_sign: [0],
  prep_kind: "attach",
  reveal_tx_hex: "0200000001...",
  asset_utxo_id: "revealthash:0",
};

describe("requestSellQuote", () => {
  it("maps wire response (no prep) to domain SellQuote", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP }),
    });
    const quote = await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
      listingType: "counterparty",
      assetUtxoId: "abcd:0",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
    });
    expect(quote).toEqual({
      swapPsbt: "70736274ff_swap",
      swapInputsToSign: [0],
      feePsbt: "70736274ff_fee",
      feeInputsToSign: [0],
      feePaymentId: "fp_abc123",
      feeWaived: false,
      assetUtxoId: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234:0",
      assetUtxoValue: 600,
      prepPsbt: null,
      prepInputsToSign: [],
      prepKind: null,
      revealTxHex: undefined,
      paymentAddress: undefined,
      paymentAmount: undefined,
      listingFeeSats: null,
      attachFeeSats: null,
      networkFeeSats: null,
    });
  });

  it("maps the fee breakdown fields when present", async () => {
    const wire = {
      ...WIRE_SELL_QUOTE_NO_PREP,
      listing_fee_sats: 5000,
      attach_fee_sats: 1200,
      network_fee_sats: 300,
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const quote = await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
    });
    expect(quote.listingFeeSats).toBe(5000);
    expect(quote.attachFeeSats).toBe(1200);
    expect(quote.networkFeeSats).toBe(300);
  });

  it("defaults the fee breakdown fields to null when absent", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP }),
    });
    const quote = await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
    });
    expect(quote.listingFeeSats).toBeNull();
    expect(quote.attachFeeSats).toBeNull();
    expect(quote.networkFeeSats).toBeNull();
  });

  it("forwards preview in the request body when set", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
      preview: true,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).preview).toBe(true);
  });

  it("omits preview from the request body when unset", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestSellQuote(http, { price: 250000, sellerAddress: "bc1qseller" });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect("preview" in JSON.parse(init.body as string)).toBe(false);
  });

  it("maps wire response with prep (zeld_transfer) to domain SellQuote", async () => {
    const wire = {
      ...WIRE_SELL_QUOTE_NO_PREP,
      fee_psbt: null,
      fee_inputs_to_sign: [],
      prep_psbt: "70736274ff_zeld_prep",
      prep_inputs_to_sign: [0, 1],
      prep_kind: "zeld_transfer",
      payment_address: "bc1qplatformfee",
      payment_amount: 10_000,
      asset_utxo_id: "zeldpreptxid:0",
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const quote = await requestSellQuote(http, {
      price: 250_000,
      sellerAddress: "bc1qseller",
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: 100_000_000n,
    });
    expect(quote.prepPsbt).toBe("70736274ff_zeld_prep");
    expect(quote.prepKind).toBe("zeld_transfer");
    expect(quote.prepInputsToSign).toEqual([0, 1]);
    expect(quote.feePsbt).toBeNull();
    expect(quote.paymentAddress).toBe("bc1qplatformfee");
    expect(quote.paymentAmount).toBe(10_000);
    expect(quote.assetUtxoId).toBe("zeldpreptxid:0");
  });

  it("maps wire response with prep (attach) to domain SellQuote", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SELL_QUOTE_WITH_PREP }),
    });
    const quote = await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
    });
    expect(quote.prepPsbt).toBe("70736274ff_prep");
    expect(quote.prepKind).toBe("attach");
    expect(quote.revealTxHex).toBe("0200000001...");
    expect(quote.assetUtxoId).toBe("revealthash:0");
  });

  it("sends flat snake_case body with listing_type", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestSellQuote(http, {
      price: 100000,
      sellerAddress: "bc1qseller",
      listingType: "counterparty",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.price).toBe(100000);
    expect(body.seller_address).toBe("bc1qseller");
    expect(body.listing_type).toBe("counterparty");
    expect(body.asset_name).toBe("RAREPEPE");
    expect(body.asset_quantity).toBe(1); // bigint <= MAX_SAFE_INTEGER → number
    expect(body).not.toHaveProperty("data"); // must not wrap in { data }
  });

  it("serializes large asset_quantity as string", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    const bigQty = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await requestSellQuote(http, {
      price: 100000,
      sellerAddress: "bc1qseller",
      assetQuantity: bigQty,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.asset_quantity).toBe(bigQty.toString());
  });

  it("omits seller_pubkey when not provided", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestSellQuote(http, { price: 100000, sellerAddress: "bc1qseller" });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("seller_pubkey");
  });

  it("includes seller_pubkey when provided (P2TR)", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_SELL_QUOTE_NO_PREP });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestSellQuote(http, {
      price: 100000,
      sellerAddress: "bc1pseller",
      sellerPubkey: "aabbccdd",
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.seller_pubkey).toBe("aabbccdd");
  });
});
