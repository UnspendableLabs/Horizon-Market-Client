import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { signAndFinalizeSellPrep } from "./sell-prep.js";
import { signPsbtHex } from "../crypto/psbt-signer.js";
import type { Signer } from "../crypto/signer.js";
import type { SellQuote } from "../types/index.js";
import { FIXTURE_PSBT_HEX, TEST_PRIVATE_KEY_HEX } from "../test-utils.js";

const BASE_QUOTE: SellQuote = {
  swapPsbt: "70736274ff_swap",
  swapInputsToSign: [0],
  feePsbt: null,
  feeInputsToSign: [],
  feePaymentId: "fp_abc",
  feeWaived: false,
  assetUtxoId: "preptxid:0",
  assetUtxoValue: 600,
  prepPsbt: null,
  prepInputsToSign: [],
  prepKind: null,
  listingFeeSats: null,
  attachFeeSats: null,
  networkFeeSats: null,
};

function hybridSigner(): Signer {
  return {
    getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
    signPsbtHex: vi.fn((hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    ),
    signMessage: () => "base64sig",
  };
}

/** {@link hybridSigner} whose signPsbtHex resolves asynchronously (external wallet). */
function asyncHybridSigner(): Signer {
  return {
    getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
    signPsbtHex: vi.fn(async (hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    ),
    signMessage: async () => "base64sig",
  };
}

describe("signAndFinalizeSellPrep", () => {
  it("returns undefined when quote has no prep PSBT", async () => {
    const signer = hybridSigner();
    expect(
      await signAndFinalizeSellPrep(BASE_QUOTE, signer, btc.networks.bitcoin),
    ).toBeUndefined();
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("finalizes attach prep to funding_tx_hex", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "attach",
        revealTxHex: "02000000reveal",
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.fundingTxHex?.startsWith("70736274ff")).toBe(false);
    expect(result?.revealTxHex).toBe("02000000reveal");
    expect(result?.zeldPayment).toBeUndefined();
  });

  it("finalizes zeld transfer prep to zeld_payment fields", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "zeld_transfer",
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.zeldPayment).toMatchObject({ feePaymentId: "fp_abc" });
    expect(result?.zeldPayment?.zeldSendTxHex.startsWith("70736274ff")).toBe(
      false,
    );
    expect(result?.zeldPayment?.zeldSendTxId).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.fundingTxHex).toBeUndefined();
  });

  it("finalizes zeld transfer prep to funding_tx_hex when fee is waived", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "zeld_transfer",
        feeWaived: true,
        feePaymentId: null,
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.zeldPayment).toBeUndefined();
  });

  it("awaits an asynchronous signer before finalizing (external wallet)", async () => {
    const signer = asyncHybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "attach",
        revealTxHex: "02000000reveal",
      },
      signer,
      btc.networks.bitcoin,
    );

    // Finalization parses the RESOLVED signed hex as a transaction — an
    // unresolved Promise (dropped `await`) would not be finalizable hex.
    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.fundingTxHex?.startsWith("70736274ff")).toBe(false);
  });

  it("throws when prep_psbt is present but prep_kind is null", async () => {
    const signer = hybridSigner();
    await expect(
      signAndFinalizeSellPrep(
        {
          ...BASE_QUOTE,
          prepPsbt: FIXTURE_PSBT_HEX,
          prepInputsToSign: [0],
          prepKind: null,
        },
        signer,
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow('Unexpected prep_kind "null"');
  });
});
