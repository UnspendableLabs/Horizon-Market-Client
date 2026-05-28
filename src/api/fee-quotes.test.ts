import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import { requestFeeQuote } from "./fee-quotes.js";
import { makeFetch } from "../test-utils.js";

const WIRE_FEE_QUOTE_BTC = {
  fee_payment_id: "fp_btc_123",
  psbt: "70736274ff_fee",
  raw_transaction: "0200000001...",
  inputs_to_sign: [0],
};

const WIRE_FEE_QUOTE_ZELD = {
  fee_payment_id: "fp_zeld_456",
  payment_address: "bc1qfeeaddr",
  payment_amount: 5000,
};

describe("requestFeeQuote", () => {
  it("returns FeeQuoteBtc when psbt is present in response", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_FEE_QUOTE_BTC }),
    });
    const result = await requestFeeQuote(http, {
      address: "bc1qseller",
      utxoSetIds: ["txid:0"],
      satsPerVbyte: 5,
    });
    expect(result).toEqual({
      feePaymentId: "fp_btc_123",
      psbt: "70736274ff_fee",
      rawTransaction: "0200000001...",
      inputsToSign: [0],
    });
  });

  it("returns FeeQuoteZeldTransferPrep when paymentAddress is present", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_FEE_QUOTE_ZELD }),
    });
    const result = await requestFeeQuote(http, { type: "zeld", address: "bc1qseller" });
    expect(result).toEqual({
      feePaymentId: "fp_zeld_456",
      paymentAddress: "bc1qfeeaddr",
      paymentAmount: 5000,
    });
  });

  it("sends flat BTC body with utxo_set_ids (not data wrapper)", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_FEE_QUOTE_BTC });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestFeeQuote(http, {
      address: "bc1qseller",
      utxoSetIds: ["txid1:0", "txid2:1"],
      satsPerVbyte: 10,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.address).toBe("bc1qseller");
    expect(body.utxo_set_ids).toEqual(["txid1:0", "txid2:1"]);
    expect(body.sats_per_vbyte).toBe(10);
    expect(body).not.toHaveProperty("data");
  });

  it("sends flat ZELD body with type field", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_FEE_QUOTE_ZELD });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestFeeQuote(http, { type: "zeld", address: "bc1qseller" });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("zeld");
    expect(body.address).toBe("bc1qseller");
  });
});
