import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { HttpClient } from "../api/http.js";
import type { Signer } from "../crypto/signer.js";
import { signPsbtHex } from "../crypto/psbt-signer.js";
import { openSellOrder } from "./sell.js";
import {
  TEST_PRIVATE_KEY_HEX,
  FIXTURE_PSBT_HEX,
  makeSequentialFetch,
  makeSigner,
} from "../test-utils.js";

const WIRE_SELL_QUOTE = {
  swap_psbt: "70736274ff_swap",
  swap_inputs_to_sign: [0],
  fee_psbt: "70736274ff_fee",
  fee_inputs_to_sign: [0],
  fee_payment_id: "fp_abc",
  asset_utxo_id: "quoteutxo:0",
  asset_utxo_value: 600,
  prep_psbt: null,
  prep_inputs_to_sign: [],
  prep_kind: null,
};

const WIRE_SWAP = {
  id: "swap_abc",
  listing_type: "xcp",
  seller_address: "bc1qseller",
  buyer_address: null,
  asset_utxo_id: "quoteutxo:0",
  asset_utxo_value: 600,
  asset_name: "RAREPEPE",
  asset_quantity: "1",
  price: 250000,
  price_per_unit: 250000,
  psbt_hex: "signed_hex",
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


describe("openSellOrder", () => {
  it("requests quote then signs swap+fee and submits with quote-derived UTXO", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    const result = await openSellOrder(
      {
        assetUtxoId: "caller_utxo:0",
        assetName: "RAREPEPE",
        assetQuantity: 1n,
        priceSats: 250000,
        listingType: "xcp",
      },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(result.created).toBe(true);
    expect(result.swap.id).toBe("swap_abc");

    // signPsbtHex called twice: swap + fee
    expect(signer.signPsbtHex).toHaveBeenCalledTimes(2);
    expect(signer.signPsbtHex).toHaveBeenCalledWith("70736274ff_swap", [0]);
    expect(signer.signPsbtHex).toHaveBeenCalledWith("70736274ff_fee", [0]);

    // Create body must use quote-derived UTXO, not caller-supplied
    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(body.asset_utxo_id).toBe("quoteutxo:0");
    expect(body.asset_utxo_value).toBe(600);
    expect(body.psbt_hex).toBe("70736274ff_swap_signed");
    expect(body.fee_payment).toEqual({
      psbt_hex: "70736274ff_fee_signed",
      fee_payment_id: "fp_abc",
    });
  });

  it("skips fee signing and omits fee_payment when feePsbt is null", async () => {
    const quoteNoFee = { ...WIRE_SELL_QUOTE, fee_psbt: null, fee_inputs_to_sign: [] };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteNoFee } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await openSellOrder(
      { assetUtxoId: "utxo:0", assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "xcp" },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(signer.signPsbtHex).toHaveBeenCalledTimes(1);
    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(body.fee_payment).toBeUndefined();
  });

  it("returns created: false when server returns 200 (ZELD idempotency)", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 200, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    const result = await openSellOrder(
      { assetUtxoId: "utxo:0", assetName: "ZELD", assetQuantity: 1n, priceSats: 250000, listingType: "zeld" },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(result.created).toBe(false);
  });

  it("throws for ZELD on testnet", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        { assetUtxoId: "utxo:0", assetName: "ZELD", assetQuantity: 1n, priceSats: 1000, listingType: "zeld" },
        http,
        signer,
        "testnet",
        btc.networks.testnet,
      ),
    ).rejects.toThrow("ZELD listings are only supported on mainnet");
  });

  it("throws for ZELD transfer prep (no assetUtxoId) in v1", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        { assetName: "ZELD", assetQuantity: 1n, priceSats: 1000, listingType: "zeld" },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("Phase 7");
  });

  it("auto-fills sellerAddress from signer P2WPKH when omitted", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "xcp" },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    const [, quoteInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const quoteBody = JSON.parse(quoteInit.body as string);
    expect(quoteBody.seller_address).toBe("bc1qseller");
  });

  it("auto-fills seller_pubkey for P2TR sellerAddress", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner({ p2tr: "bc1pseller", xOnlyPubkey: "aabbccdd" });

    await openSellOrder(
      { sellerAddress: "bc1pseller", assetUtxoId: "utxo:0", priceSats: 250000, listingType: "ordinal" },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    const [, quoteInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const quoteBody = JSON.parse(quoteInit.body as string);
    expect(quoteBody.seller_pubkey).toBe("aabbccdd");
  });

  it("signs and finalizes attach prep PSBT → funding_tx_hex on create", async () => {
    const quoteWithPrep = {
      ...WIRE_SELL_QUOTE,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "attach",
      asset_utxo_id: "revealthash:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteWithPrep } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });

    // Hybrid signer: real signing for the prep PSBT, stub for all others
    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: (hex, indices) =>
        hex === FIXTURE_PSBT_HEX
          ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
          : `${hex}_signed`,
      signMessage: () => "base64sig",
    };

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "xcp" },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(typeof body.funding_tx_hex).toBe("string");
    expect(body.funding_tx_hex.length).toBeGreaterThan(0);
    expect(body.funding_tx_hex.startsWith("70736274ff")).toBe(false); // raw tx, not PSBT
    expect(body.asset_utxo_id).toBe("revealthash:0");
  });

  it("passes reveal_tx_hex unchanged from quote when attach+reveal", async () => {
    const quoteWithReveal = {
      ...WIRE_SELL_QUOTE,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "attach",
      reveal_tx_hex: "0200000001reveal...",
      asset_utxo_id: "revealthash:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteWithReveal } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });

    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: (hex, indices) =>
        hex === FIXTURE_PSBT_HEX
          ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
          : `${hex}_signed`,
      signMessage: () => "base64sig",
    };

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "xcp" },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(body.reveal_tx_hex).toBe("0200000001reveal...");
  });
});
