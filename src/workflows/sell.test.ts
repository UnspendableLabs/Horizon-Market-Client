import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { HttpClient, HorizonMarketApiError } from "../api/http.js";
import type { Signer } from "../crypto/signer.js";
import { signPsbtHex } from "../crypto/psbt-signer.js";
import { openSellOrder } from "./sell.js";
import type { WorkflowProgressEvent } from "../types/progress.js";
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
  fee_waived: false,
  asset_utxo_id: "quoteutxo:0",
  asset_utxo_value: 600,
  prep_psbt: null,
  prep_inputs_to_sign: [],
  prep_kind: null,
};

const WIRE_SWAP = {
  id: "swap_abc",
  listing_type: "counterparty",
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
        listingType: "counterparty",
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
      { assetUtxoId: "utxo:0", assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
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
      {
        assetUtxoId: "utxo:0",
        assetName: "ZELD",
        assetQuantity: 1n,
        priceSats: 250000,
        listingType: "zeld",
      },
      http,
      signer,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(result.created).toBe(false);
  });

  it("throws HorizonMarketApiError on 409 ZELD conflict", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 409, body: { error: "Conflicting zeld listing" } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        {
          assetUtxoId: "utxo:0",
          assetName: "ZELD",
          assetQuantity: 1n,
          priceSats: 250000,
          listingType: "zeld",
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toMatchObject({
      status: 409,
      error: "Conflicting zeld listing",
    });
    await expect(
      openSellOrder(
        {
          assetUtxoId: "utxo:0",
          assetName: "ZELD",
          assetQuantity: 1n,
          priceSats: 250000,
          listingType: "zeld",
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
  });

  it("throws for ZELD when assetName is not ZELD", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        {
          assetUtxoId: "utxo:0",
          assetName: "RAREPEPE",
          assetQuantity: 1n,
          priceSats: 1000,
          listingType: "zeld",
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow('assetName: "ZELD"');
  });

  it("forwards explicit sellerPubkey to sell-quotes", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await openSellOrder(
      {
        sellerAddress: "bc1pexternal",
        sellerPubkey: "deadbeef".repeat(8),
        assetUtxoId: "utxo:0",
        priceSats: 250000,
        listingType: "ordinal",
      },
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
    expect(quoteBody.seller_pubkey).toBe("deadbeef".repeat(8));
    expect(quoteBody.seller_address).toBe("bc1pexternal");
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

  it("throws when feeUtxoIds and autoSelectFeeUtxos are both set", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        {
          assetUtxoId: "utxo:0",
          assetName: "RAREPEPE",
          assetQuantity: 1n,
          priceSats: 250000,
          listingType: "counterparty",
          feeUtxoIds: ["tx:0"],
          autoSelectFeeUtxos: true,
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("mutually exclusive");
  });

  it("throws when ordinal listing has no assetUtxoId", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner({ p2tr: "bc1pseller", xOnlyPubkey: "aabbccdd" });

    await expect(
      openSellOrder(
        { priceSats: 250000, listingType: "ordinal" },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("Ordinal listings require assetUtxoId");
  });

  it("signs and finalizes zeld transfer prep → zeld_payment on create", async () => {
    const quoteWithZeldPrep = {
      ...WIRE_SELL_QUOTE,
      fee_psbt: null,
      fee_inputs_to_sign: [],
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "zeld_transfer",
      payment_address: "bc1qplatformfee",
      payment_amount: 10_000,
      asset_utxo_id: "zeldpreptxid:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteWithZeldPrep } },
      { status: 201, body: { data: { ...WIRE_SWAP, listing_type: "zeld", asset_name: "ZELD" } } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });

    const signPsbtHexFn = vi.fn((hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    );
    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: signPsbtHexFn,
      signMessage: () => "base64sig",
    };

    const result = await openSellOrder(
      {
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
        priceSats: 250_000,
        listingType: "zeld",
      },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(result.created).toBe(true);

    // signPsbtHex: prep + swap only (no fee_psbt)
    expect(signPsbtHexFn).toHaveBeenCalledTimes(2);

    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(body.zeld_payment).toMatchObject({
      fee_payment_id: "fp_abc",
    });
    expect(typeof body.zeld_payment.zeld_send_tx_hex).toBe("string");
    expect(body.zeld_payment.zeld_send_tx_hex.length).toBeGreaterThan(0);
    expect(body.zeld_payment.zeld_send_tx_hex.startsWith("70736274ff")).toBe(
      false,
    );
    expect(body.zeld_payment.zeld_send_txid).toMatch(/^[0-9a-f]{64}$/);
    expect(body.fee_payment).toBeUndefined();
    expect(body.funding_tx_hex).toBeUndefined();
    expect(body.asset_utxo_id).toBe("zeldpreptxid:0");
    expect(body.listing_type).toBe("zeld");
  });

  it("returns created: false for zeld transfer prep on HTTP 200 idempotency", async () => {
    const quoteWithZeldPrep = {
      ...WIRE_SELL_QUOTE,
      fee_psbt: null,
      fee_inputs_to_sign: [],
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "zeld_transfer",
      asset_utxo_id: "zeldpreptxid:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteWithZeldPrep } },
      {
        status: 200,
        body: { data: { ...WIRE_SWAP, listing_type: "zeld", asset_name: "ZELD" } },
      },
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

    const result = await openSellOrder(
      {
        assetName: "ZELD",
        assetQuantity: 100_000_000n,
        priceSats: 250_000,
        listingType: "zeld",
      },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    expect(result.created).toBe(false);
  });

  it("omits asset_utxo_id on sell-quotes for counterparty attach prep", async () => {
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
    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: (hex, indices) =>
        hex === FIXTURE_PSBT_HEX
          ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
          : `${hex}_signed`,
      signMessage: () => "base64sig",
    };

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250_000, listingType: "counterparty" },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    const [, quoteInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const quoteBody = JSON.parse(quoteInit.body as string);
    expect(quoteBody.asset_utxo_id).toBeUndefined();
    expect(quoteBody.asset_name).toBe("RAREPEPE");
    expect(quoteBody.asset_quantity).toBe(1);
  });

  it("auto-fills sellerAddress from signer P2WPKH when omitted", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
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

  it("auto-fills sellerAddress from signer P2TR for ordinal when omitted", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner({ p2tr: "bc1pseller", xOnlyPubkey: "aabbccdd" });

    await openSellOrder(
      { assetUtxoId: "utxo:0", priceSats: 250000, listingType: "ordinal" },
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
    expect(quoteBody.seller_address).toBe("bc1pseller");
    expect(quoteBody.seller_pubkey).toBe("aabbccdd");
  });

  it("throws when ordinal listing and signer has no P2TR address", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        { assetUtxoId: "utxo:0", priceSats: 250000, listingType: "ordinal" },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("P2TR seller address");
  });

  it("throws when external P2TR sellerAddress has no sellerPubkey", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner({ p2tr: "bc1pseller", xOnlyPubkey: "aabbccdd" });

    await expect(
      openSellOrder(
        {
          sellerAddress: "bc1pexternal",
          assetUtxoId: "utxo:0",
          priceSats: 250000,
          listingType: "ordinal",
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("P2TR sellerAddress requires sellerPubkey");
  });

  it("throws when ordinal listing uses a P2WPKH seller address", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        {
          sellerAddress: "bc1qseller",
          assetUtxoId: "utxo:0",
          priceSats: 250000,
          listingType: "ordinal",
        },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow("P2TR seller address");
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
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
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

  it("throws when prep_psbt is present but prep_kind is null", async () => {
    const quoteBadPrep = {
      ...WIRE_SELL_QUOTE,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: null,
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteBadPrep } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await expect(
      openSellOrder(
        { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250_000, listingType: "counterparty" },
        http,
        signer,
        "mainnet",
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow('Unexpected prep_kind "null"');
  });

  it("omits fee_payment and sends funding_tx_hex for counterparty attach prep when fee is waived", async () => {
    const quoteFeeWaivedAttach = {
      ...WIRE_SELL_QUOTE,
      fee_psbt: null,
      fee_inputs_to_sign: [],
      fee_payment_id: null,
      fee_waived: true,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "attach",
      asset_utxo_id: "revealthash:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteFeeWaivedAttach } },
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
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250_000, listingType: "counterparty" },
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
    expect(body.fee_payment).toBeUndefined();
    expect(body.zeld_payment).toBeUndefined();
    expect(typeof body.funding_tx_hex).toBe("string");
    expect(body.funding_tx_hex.length).toBeGreaterThan(0);
    expect(body.funding_tx_hex.startsWith("70736274ff")).toBe(false);
    expect(body.psbt_hex).toBe("70736274ff_swap_signed");
  });

  it("sends psbt-less fee_payment for counterparty attach folded fee", async () => {
    // No exact asset UTXO → server folds the platform fee into the attach prep
    // tx: fee_psbt is null but fee_payment_id is set and the fee is not waived.
    // The create must carry fee_payment: { fee_payment_id } (no PSBT), otherwise
    // anonymous listings are rejected with HTTP 400.
    const quoteFoldedFee = {
      ...WIRE_SELL_QUOTE,
      fee_psbt: null,
      fee_inputs_to_sign: [],
      fee_payment_id: "fp_folded",
      fee_waived: false,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "attach",
      asset_utxo_id: "revealthash:0",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteFoldedFee } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signPsbtHexFn = vi.fn((hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    );
    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: signPsbtHexFn,
      signMessage: () => "base64sig",
    };

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250_000, listingType: "counterparty" },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
    );

    // prep + swap only — no fee PSBT to sign for the folded fee.
    expect(signPsbtHexFn).toHaveBeenCalledTimes(2);

    const [, createInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(createInit.body as string);
    expect(body.fee_payment).toEqual({ fee_payment_id: "fp_folded" });
    expect(body.fee_payment.psbt_hex).toBeUndefined();
    expect(typeof body.funding_tx_hex).toBe("string");
    expect(body.zeld_payment).toBeUndefined();
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
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
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

  it("emits progress events for standard sell (5 steps)", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_SELL_QUOTE } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const events: WorkflowProgressEvent[] = [];

    await openSellOrder(
      {
        assetUtxoId: "utxo:0",
        assetName: "RAREPEPE",
        assetQuantity: 1n,
        priceSats: 250000,
        listingType: "counterparty",
      },
      http,
      makeSigner(),
      "mainnet",
      btc.networks.bitcoin,
      { onProgress: (e) => events.push(e) },
    );

    const startSteps = events
      .filter((e) => e.phase === "start")
      .map((e) => e.step);
    expect(startSteps).toEqual([
      "validateParams",
      "requestSellQuote",
      "signSwapPsbt",
      "signFeePsbt",
      "createSwap",
    ]);
    expect(events.at(-1)?.phase).toBe("complete");
    expect(events.at(-1)?.step).toBe("createSwap");
    expect(events.every((e) => e.workflow === "openSellOrder")).toBe(true);
    expect(events.filter((e) => e.phase === "complete").at(-1)?.totalSteps).toBe(
      5,
    );
  });

  it("emits prep sign/finalize steps when prep_psbt is present (7 steps)", async () => {
    const quoteWithPrep = {
      ...WIRE_SELL_QUOTE,
      prep_psbt: FIXTURE_PSBT_HEX,
      prep_inputs_to_sign: [0],
      prep_kind: "attach",
      reveal_tx_hex: "0200000001reveal...",
    };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteWithPrep } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const events: WorkflowProgressEvent[] = [];

    const hybridSigner: Signer = {
      getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
      signPsbtHex: (hex, indices) =>
        hex === FIXTURE_PSBT_HEX
          ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
          : `${hex}_signed`,
      signMessage: () => "base64sig",
    };

    await openSellOrder(
      { assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
      http,
      hybridSigner,
      "mainnet",
      btc.networks.bitcoin,
      { onProgress: (e) => events.push(e) },
    );

    const startSteps = events
      .filter((e) => e.phase === "start")
      .map((e) => e.step);
    expect(startSteps).toEqual([
      "validateParams",
      "requestSellQuote",
      "signPrepPsbt",
      "finalizePrepPsbt",
      "signSwapPsbt",
      "signFeePsbt",
      "createSwap",
    ]);
    expect(events.filter((e) => e.phase === "complete").at(-1)?.totalSteps).toBe(
      7,
    );
  });

  it("omits fee step from progress when fee_psbt is null (4 steps)", async () => {
    const quoteNoFee = { ...WIRE_SELL_QUOTE, fee_psbt: null, fee_inputs_to_sign: [] };
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: quoteNoFee } },
      { status: 201, body: { data: WIRE_SWAP } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const events: WorkflowProgressEvent[] = [];

    await openSellOrder(
      { assetUtxoId: "utxo:0", assetName: "RAREPEPE", assetQuantity: 1n, priceSats: 250000, listingType: "counterparty" },
      http,
      makeSigner(),
      "mainnet",
      btc.networks.bitcoin,
      { onProgress: (e) => events.push(e) },
    );

    const startSteps = events
      .filter((e) => e.phase === "start")
      .map((e) => e.step);
    expect(startSteps).toEqual([
      "validateParams",
      "requestSellQuote",
      "signSwapPsbt",
      "createSwap",
    ]);
    expect(events.filter((e) => e.phase === "complete").at(-1)?.totalSteps).toBe(
      4,
    );
  });
});
