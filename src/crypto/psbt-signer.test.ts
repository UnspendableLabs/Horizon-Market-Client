import { describe, it, expect } from "vitest";
import * as btc from "bitcoinjs-lib";
import { signPsbtHex, finalizePsbtHex } from "./psbt-signer.js";
import {
  TEST_PRIVATE_KEY_HEX,
  FIXTURE_PSBT_HEX,
  buildTaprootPsbtFixture,
  buildTaprootPsbtFixtureNoInternalKey,
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

  // Regression: server-composed fee PSBTs carry only the P2TR `witnessUtxo` and
  // omit `tapInternalKey`. bitcoinjs still routes them through its Taproot signer,
  // so signing with the raw ECDSA key threw "Can not sign for input #0 with the
  // key 03…". We must detect P2TR via the witnessUtxo script and key-path sign.
  it("signs a P2TR key-path input that lacks tapInternalKey (fee PSBT)", () => {
    const network = btc.networks.bitcoin;
    const psbtHex = buildTaprootPsbtFixtureNoInternalKey(
      TEST_PRIVATE_KEY_HEX,
      network,
    );
    const signedHex = signPsbtHex(psbtHex, [0], TEST_PRIVATE_KEY_HEX, network);

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

// ─── Tapscript (script-path) inputs — a Counterparty reveal ──────────────────

import { ECPair } from "./ecc.js";
import { signPsbtHexWithKeys } from "./psbt-signer.js";
import { buildRevealPsbt, verifyReveal } from "./reveal.js";
import { buildRevealPair, REVEAL_FIXTURE } from "../test-utils.js";

describe("signPsbtHex on a tapLeafScript input", () => {
  const network = btc.networks.bitcoin;
  const material = {
    envelopeScript: REVEAL_FIXTURE.envelopeScript,
    controlBlock: REVEAL_FIXTURE.controlBlock,
    pubkey: REVEAL_FIXTURE.xOnlyPubkey,
    lockScript: REVEAL_FIXTURE.lockScript,
    inputValue: REVEAL_FIXTURE.inputValue,
  };
  const revealPsbtHex = buildRevealPsbt(
    verifyReveal(REVEAL_FIXTURE.revealTxHex, material, {
      commitTxHex: REVEAL_FIXTURE.commitTxHex,
    }),
    network,
  ).toHex();

  it("produces a script-path signature with the untweaked key, and no key-path one", () => {
    const signed = btc.Psbt.fromHex(
      signPsbtHex(revealPsbtHex, [0], TEST_PRIVATE_KEY_HEX, network),
      { network },
    );
    const input = signed.data.inputs[0];
    expect(input.tapKeySig).toBeUndefined();
    expect(input.tapScriptSig).toHaveLength(1);
    expect(Buffer.from(input.tapScriptSig![0].pubkey).toString("hex")).toBe(
      REVEAL_FIXTURE.xOnlyPubkey,
    );
    expect(input.tapScriptSig![0].signature).toHaveLength(64);
    // …and it finalizes to <sig> <envelope> <control block>.
    const { txHex } = finalizePsbtHex(signed.toHex(), network);
    expect(btc.Transaction.fromHex(txHex).ins[0].witness).toHaveLength(3);
  });

  it("picks whichever of an HD wallet's keys closes the leaf", () => {
    const segwitKey = TEST_PRIVATE_KEY_HEX;
    const taprootKey = "2".repeat(64);
    const taprootXOnly = Buffer.from(
      ECPair.fromPrivateKey(Buffer.from(taprootKey, "hex")).publicKey.subarray(1, 33),
    ).toString("hex");
    const pair = buildRevealPair(taprootXOnly);
    const psbtHex = buildRevealPsbt(
      verifyReveal(pair.revealTxHex, pair.material, { commitTxHex: pair.commitTxHex }),
      network,
    ).toHex();

    const signed = btc.Psbt.fromHex(
      signPsbtHexWithKeys(
        psbtHex,
        [0],
        { ecdsaKeyHex: segwitKey, taprootKeyHex: taprootKey },
        network,
      ),
      { network },
    );
    expect(Buffer.from(signed.data.inputs[0].tapScriptSig![0].pubkey).toString("hex")).toBe(
      taprootXOnly,
    );
  });

  it("refuses to sign a leaf closed by a key it does not hold", () => {
    expect(() => signPsbtHex(revealPsbtHex, [0], "3".repeat(64), network)).toThrow(
      /key this signer does not hold/,
    );
  });

  it("refuses a sighash type the Counterparty parser rejects", () => {
    const psbt = btc.Psbt.fromHex(revealPsbtHex, { network });
    psbt.updateInput(0, {
      sighashType: btc.Transaction.SIGHASH_SINGLE | btc.Transaction.SIGHASH_ANYONECANPAY,
    });
    expect(() => signPsbtHex(psbt.toHex(), [0], TEST_PRIVATE_KEY_HEX, network)).toThrow(
      /Sighash type is not allowed/,
    );
  });
});
