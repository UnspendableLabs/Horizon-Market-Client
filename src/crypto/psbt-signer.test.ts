import { describe, it, expect } from "vitest";
import * as btc from "bitcoinjs-lib";
import { signPsbtHex, finalizePsbtHex } from "./psbt-signer.js";
import {
  TEST_PRIVATE_KEY_HEX,
  FIXTURE_PSBT_HEX,
  buildTaprootPsbtFixture,
} from "../test-utils.js";

describe("signPsbtHex", () => {
  it("signs a P2WPKH input and returns a valid PSBT hex", () => {
    const network = btc.networks.bitcoin;
    const signedHex = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [0],
      TEST_PRIVATE_KEY_HEX,
      network,
    );

    expect(typeof signedHex).toBe("string");
    expect(signedHex.length).toBeGreaterThan(FIXTURE_PSBT_HEX.length);

    // Parse back and verify the input has a partial signature
    const psbt = btc.Psbt.fromHex(signedHex, { network });
    expect(psbt.data.inputs[0].partialSig).toBeDefined();
    expect(psbt.data.inputs[0].partialSig!.length).toBeGreaterThan(0);
  });

  it("strips 0x prefix from private key", () => {
    const network = btc.networks.bitcoin;
    const signed1 = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [0],
      TEST_PRIVATE_KEY_HEX,
      network,
    );
    const signed2 = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [0],
      `0x${TEST_PRIVATE_KEY_HEX}`,
      network,
    );

    // Both should parse as valid PSBTs with a signature
    const psbt1 = btc.Psbt.fromHex(signed1, { network });
    const psbt2 = btc.Psbt.fromHex(signed2, { network });
    expect(psbt1.data.inputs[0].partialSig).toBeDefined();
    expect(psbt2.data.inputs[0].partialSig).toBeDefined();
  });

  it("does not sign inputs not in the indices list", () => {
    const network = btc.networks.bitcoin;
    // Pass empty list — no inputs should be signed
    const signedHex = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [],
      TEST_PRIVATE_KEY_HEX,
      network,
    );

    const psbt = btc.Psbt.fromHex(signedHex, { network });
    expect(psbt.data.inputs[0].partialSig).toBeUndefined();
  });

  it("returns a hex string (not finalized)", () => {
    const network = btc.networks.bitcoin;
    const signedHex = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [0],
      TEST_PRIVATE_KEY_HEX,
      network,
    );

    // Should still be a valid PSBT (not raw tx)
    expect(() => btc.Psbt.fromHex(signedHex, { network })).not.toThrow();
  });

  it("signs a P2TR key-path input and sets tapKeySig", () => {
    const network = btc.networks.bitcoin;
    const psbtHex = buildTaprootPsbtFixture(TEST_PRIVATE_KEY_HEX, network);
    const signedHex = signPsbtHex(
      psbtHex,
      [0],
      TEST_PRIVATE_KEY_HEX,
      network,
    );

    const psbt = btc.Psbt.fromHex(signedHex, { network });
    expect(psbt.data.inputs[0].tapKeySig).toBeDefined();
    expect(psbt.data.inputs[0].tapKeySig!.length).toBeGreaterThan(0);
    expect(psbt.data.inputs[0].partialSig).toBeUndefined();
  });
});

describe("finalizePsbtHex", () => {
  it("finalizes a signed P2WPKH PSBT and returns raw tx hex and txid", () => {
    const network = btc.networks.bitcoin;
    const signedHex = signPsbtHex(
      FIXTURE_PSBT_HEX,
      [0],
      TEST_PRIVATE_KEY_HEX,
      network,
    );
    const { txHex, txId } = finalizePsbtHex(signedHex, network);

    expect(typeof txHex).toBe("string");
    expect(txHex.length).toBeGreaterThan(0);
    expect(typeof txId).toBe("string");
    expect(txId).toMatch(/^[0-9a-f]{64}$/);

    // Must be a valid raw tx (not a PSBT — does not start with magic bytes 70736274ff)
    expect(txHex.startsWith("70736274ff")).toBe(false);
  });
});
