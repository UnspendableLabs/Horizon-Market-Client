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
      listingType: "xcp",
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
      assetUtxoId: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234:0",
      assetUtxoValue: 600,
      prepPsbt: null,
      prepInputsToSign: [],
      prepKind: null,
      revealTxHex: undefined,
      paymentAddress: undefined,
      paymentAmount: undefined,
    });
  });

  it("maps wire response with prep (attach) to domain SellQuote", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_SELL_QUOTE_WITH_PREP }),
    });
    const quote = await requestSellQuote(http, {
      price: 250000,
      sellerAddress: "bc1qseller",
      listingType: "xcp",
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
      listingType: "xcp",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.price).toBe(100000);
    expect(body.seller_address).toBe("bc1qseller");
    expect(body.listing_type).toBe("xcp");
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
