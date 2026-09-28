import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { ecc, ECPair } from "./ecc.js";
import { LocalSigner, HDSigner, type Signer } from "./signer.js";
import {
  assertSignedReveal,
  buildRevealPsbt,
  carriesInlineCounterpartyData,
  envelopeSigningKey,
  PresignedRevealError,
  RevealVerificationError,
  signReveal,
  tapleafHash,
  taprootOutputKeyHex,
  toXOnlyHex,
  unsignedTxHexFromPsbt,
  verifyReveal,
} from "./reveal.js";
import {
  buildRevealPair,
  FIXTURE_PSBT_HEX,
  REVEAL_FIXTURE,
  revealFixtureCommitPsbtHex,
  TEST_PRIVATE_KEY_HEX,
} from "../test-utils.js";

const network = btc.networks.bitcoin;
const F = REVEAL_FIXTURE;
const MATERIAL = {
  envelopeScript: F.envelopeScript,
  controlBlock: F.controlBlock,
  pubkey: F.xOnlyPubkey,
  lockScript: F.lockScript,
  inputValue: F.inputValue,
};
const OPTIONS = { commitTxHex: F.commitTxHex, expectedKeys: [F.xOnlyPubkey] };

/** x-only key of a private key given as a repeated hex digit. */
function xOnlyOf(digit: string): string {
  const pair = ECPair.fromPrivateKey(Buffer.from(digit.repeat(64), "hex"));
  return Buffer.from(pair.publicKey.subarray(1, 33)).toString("hex");
}

function witnessOf(txHex: string): Buffer[] {
  return btc.Transaction.fromHex(txHex).ins[0].witness.map((w) => Buffer.from(w));
}

// The vector was produced by the node's own bitcoinutils construction and
// signed by the reference wallet routine of its regtest suite. Agreeing with it
// byte for byte on the sighash is what makes the TypeScript side trustworthy.
describe("cross-implementation vector (bitcoinutils / counterparty-core)", () => {
  it("computes the same script-path sighash as bitcoinutils", () => {
    const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);
    const sighash = verified.reveal.hashForWitnessV1(
      0,
      [verified.lockScript],
      [verified.inputValue],
      btc.Transaction.SIGHASH_DEFAULT,
      verified.leafHash,
    );
    expect(Buffer.from(sighash).toString("hex")).toBe(F.sighash);
  });

  it("accepts the reference signature over that sighash", () => {
    expect(
      ecc.verifySchnorr(
        Buffer.from(F.sighash, "hex"),
        Buffer.from(F.xOnlyPubkey, "hex"),
        Buffer.from(F.pythonSignature, "hex"),
      ),
    ).toBe(true);
    const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);
    expect(assertSignedReveal(F.signedRevealTxHex, verified)).toEqual({
      revealTxHex: F.signedRevealTxHex,
      revealTxid: F.revealTxid,
    });
  });

  it("signs the reveal with a LocalSigner into the reference witness shape", async () => {
    const signer = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const signed = await signReveal({
      revealTxHex: F.revealTxHex,
      material: MATERIAL,
      commitTxHex: F.commitTxHex,
      signer,
      network,
    });
    expect(signed.revealTxid).toBe(F.revealTxid);

    const ours = witnessOf(signed.revealTxHex);
    const reference = witnessOf(F.signedRevealTxHex);
    expect(ours).toHaveLength(3);
    // Schnorr signatures carry auxiliary randomness, so only the signature
    // bytes may differ; the envelope and control block must be identical.
    expect(ours[0]).toHaveLength(64);
    expect(ours[1].equals(reference[1])).toBe(true);
    expect(ours[2].equals(reference[2])).toBe(true);
    expect(
      ecc.verifySchnorr(
        Buffer.from(F.sighash, "hex"),
        Buffer.from(F.xOnlyPubkey, "hex"),
        ours[0],
      ),
    ).toBe(true);
    // Everything but the witness is the unsigned reveal, unchanged.
    const stripped = btc.Transaction.fromHex(signed.revealTxHex);
    stripped.ins[0].witness = [];
    expect(stripped.toHex()).toBe(F.revealTxHex);
  });
});

describe("buildRevealPair (test builder)", () => {
  it("reproduces the node's construction byte for byte", () => {
    // Same key, same payload → same envelope, control block and commit output.
    const pair = buildRevealPair(F.xOnlyPubkey);
    expect(pair.material).toEqual(MATERIAL);
    expect(pair.commitTxHex).toBe(F.commitTxHex);
    expect(pair.revealTxHex).toBe(F.revealTxHex);
  });
});

describe("signReveal with an HDSigner", () => {
  const segwitKey = TEST_PRIVATE_KEY_HEX;
  const taprootKey =
    "1111111111111111111111111111111111111111111111111111111111111111";
  const signer = new HDSigner({ segwitKeyHex: segwitKey, taprootKeyHex: taprootKey });
  const addresses = signer.getAddresses();

  it("signs a leaf closed by the BIP84 (segwit) key — a P2WPKH source", async () => {
    const pair = buildRevealPair(toXOnlyHex(addresses.publicKey));
    const signed = await signReveal({ ...pair, signer, network });
    expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
  });

  it("signs a leaf closed by the BIP86 internal key — a P2TR source with its key known", async () => {
    const pair = buildRevealPair(addresses.xOnlyPubkey!);
    const signed = await signReveal({ ...pair, signer, network });
    expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
  });

  it("signs a leaf closed by the P2TR output key — the composer's fallback", async () => {
    const outputKey = taprootOutputKeyHex(addresses.xOnlyPubkey!)!;
    const pair = buildRevealPair(outputKey);
    const signed = await signReveal({ ...pair, signer, network });
    const [sig] = witnessOf(signed.revealTxHex);
    const verified = verifyReveal(pair.revealTxHex, pair.material, {
      commitTxHex: pair.commitTxHex,
    });
    const sighash = verified.reveal.hashForWitnessV1(
      0,
      [verified.lockScript],
      [verified.inputValue],
      0,
      verified.leafHash,
    );
    expect(ecc.verifySchnorr(sighash, Buffer.from(outputKey, "hex"), sig)).toBe(true);
  });

  it("refuses a leaf closed by a key the wallet does not hold", async () => {
    const stranger = ECPair.makeRandom().publicKey.subarray(1, 33);
    const pair = buildRevealPair(Buffer.from(stranger).toString("hex"));
    await expect(signReveal({ ...pair, signer, network })).rejects.toThrow(
      /key this wallet does not hold/,
    );
  });
});

describe("verifyReveal", () => {
  it("returns the parsed pieces", () => {
    const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);
    expect(verified.commitTxid).toBe(F.commitTxid);
    expect(verified.revealTxid).toBe(F.revealTxid);
    expect(verified.inputValue).toBe(5000n);
    expect(verified.leafHash.equals(tapleafHash(verified.envelope))).toBe(true);
  });

  it("accepts a compressed key in expectedKeys", () => {
    const compressed = ECPair.fromPrivateKey(
      Buffer.from(TEST_PRIVATE_KEY_HEX, "hex"),
    ).publicKey;
    expect(() =>
      verifyReveal(F.revealTxHex, MATERIAL, {
        commitTxHex: F.commitTxHex,
        expectedKeys: [Buffer.from(compressed).toString("hex")],
      }),
    ).not.toThrow();
  });

  it("rejects an envelope closed by a key other than reveal_pubkey", () => {
    const other = buildRevealPair(xOnlyOf("b"));
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, envelopeScript: other.material.envelopeScript }, OPTIONS),
    ).toThrow(/closed by a key other than reveal_pubkey/);
  });

  it("rejects a non-canonical envelope", () => {
    // Slip an OP_DUP inside the envelope: still a valid script, not an envelope.
    const chunks = btc.script.decompile(Buffer.from(F.envelopeScript, "hex"))!;
    chunks.splice(2, 0, btc.opcodes.OP_DUP);
    const tampered = Buffer.from(btc.script.compile(chunks)).toString("hex");
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, envelopeScript: tampered }, OPTIONS),
    ).toThrow(/not a canonical envelope/);
  });

  it("rejects a lock script that is not the envelope's P2TR output", () => {
    const stranger = buildRevealPair(xOnlyOf("c"));
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, lockScript: stranger.material.lockScript }, OPTIONS),
    ).toThrow(/reveal_lock_scripts\[0\]/);
  });

  it("rejects a control block that does not prove the leaf", () => {
    const flipped = Buffer.from(F.controlBlock, "hex");
    flipped[0] ^= 0x01; // parity bit
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, controlBlock: flipped.toString("hex") }, OPTIONS),
    ).toThrow(/reveal_control_block/);
  });

  it("rejects a commit whose output 0 is not the envelope output", () => {
    const other = buildRevealPair(xOnlyOf("d"));
    expect(() =>
      verifyReveal(F.revealTxHex, MATERIAL, { ...OPTIONS, commitTxHex: other.commitTxHex }),
    ).toThrow(/output 0 of the commit/);
  });

  it("rejects a value that differs from the commit output", () => {
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, inputValue: 4999 }, OPTIONS),
    ).toThrow(/differs from the commit output value/);
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, inputValue: 0 }, OPTIONS),
    ).toThrow(/positive integer/);
  });

  it("rejects a reveal that does not spend commit:0", () => {
    const other = buildRevealPair(F.xOnlyPubkey, { data: Buffer.alloc(100, 9) });
    expect(() => verifyReveal(other.revealTxHex, MATERIAL, OPTIONS)).toThrow(
      /spends .*, not /,
    );
    const reveal = btc.Transaction.fromHex(F.revealTxHex);
    reveal.ins[0].index = 1;
    expect(() => verifyReveal(reveal.toHex(), MATERIAL, OPTIONS)).toThrow(/:0/);
  });

  it("rejects a reveal with more than one input", () => {
    const reveal = btc.Transaction.fromHex(F.revealTxHex);
    reveal.addInput(Buffer.alloc(32, 0xbb), 0);
    expect(() => verifyReveal(reveal.toHex(), MATERIAL, OPTIONS)).toThrow(
      /2 inputs/,
    );
  });

  it("rejects an already-signed reveal", () => {
    expect(() => verifyReveal(F.signedRevealTxHex, MATERIAL, OPTIONS)).toThrow(
      /already signed/,
    );
  });

  it("rejects a reveal without a CNTRPRTY OP_RETURN", () => {
    const reveal = btc.Transaction.fromHex(F.revealTxHex);
    reveal.outs[0].script = btc.address.toOutputScript(F.sourceAddress, network);
    expect(() => verifyReveal(reveal.toHex(), MATERIAL, OPTIONS)).toThrow(
      /OP_RETURN CNTRPRTY/,
    );
  });

  it("rejects a reveal that spends more than the commit output", () => {
    const reveal = btc.Transaction.fromHex(F.revealTxHex);
    reveal.addOutput(btc.address.toOutputScript(F.sourceAddress, network), 5001n);
    expect(() => verifyReveal(reveal.toHex(), MATERIAL, OPTIONS)).toThrow(
      /more than the commit output holds/,
    );
  });

  it("rejects malformed hex and a bad key length", () => {
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, envelopeScript: "zz" }, OPTIONS),
    ).toThrow(/not valid hex/);
    expect(() =>
      verifyReveal(F.revealTxHex, { ...MATERIAL, pubkey: "aabb" }, OPTIONS),
    ).toThrow(/32-byte/);
    expect(() =>
      verifyReveal("nothex", MATERIAL, OPTIONS),
    ).toThrow(/reveal_rawtransaction/);
    expect(() =>
      verifyReveal(F.revealTxHex, MATERIAL, { ...OPTIONS, commitTxHex: "nothex" }),
    ).toThrow(/commit transaction/);
  });
});

describe("assertSignedReveal", () => {
  const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);

  function withWitness(witness: Buffer[]): string {
    const tx = btc.Transaction.fromHex(F.revealTxHex);
    tx.ins[0].witness = witness;
    return tx.toHex();
  }
  const [sig, envelope, controlBlock] = witnessOf(F.signedRevealTxHex);

  it("accepts a SIGHASH_ALL signature (65 bytes ending in 0x01)", () => {
    const sighash = verified.reveal.hashForWitnessV1(
      0,
      [verified.lockScript],
      [verified.inputValue],
      btc.Transaction.SIGHASH_ALL,
      verified.leafHash,
    );
    const key = ECPair.fromPrivateKey(Buffer.from(TEST_PRIVATE_KEY_HEX, "hex"));
    const sigAll = Buffer.concat([
      Buffer.from(ecc.signSchnorr(sighash, key.privateKey!)),
      Buffer.from([0x01]),
    ]);
    expect(() =>
      assertSignedReveal(withWitness([sigAll, envelope, controlBlock]), verified),
    ).not.toThrow();
  });

  it("rejects a witness that is not <sig> <envelope> <control block>", () => {
    expect(() => assertSignedReveal(withWitness([sig, envelope]), verified)).toThrow(
      /2 elements/,
    );
    expect(() =>
      assertSignedReveal(withWitness([sig, controlBlock, envelope]), verified),
    ).toThrow(/different envelope/);
    expect(() =>
      assertSignedReveal(withWitness([sig, envelope, Buffer.from(F.xOnlyPubkey, "hex")]), verified),
    ).toThrow(/different control block/);
  });

  it("rejects a signature over the wrong hash or with a forbidden sighash type", () => {
    const wrong = Buffer.from(sig);
    wrong[5] ^= 0xff;
    expect(() =>
      assertSignedReveal(withWitness([wrong, envelope, controlBlock]), verified),
    ).toThrow(/does not verify/);
    const single = Buffer.concat([sig, Buffer.from([0x83])]);
    expect(() =>
      assertSignedReveal(withWitness([single, envelope, controlBlock]), verified),
    ).toThrow(/64 bytes .* or 65 bytes/);
  });

  it("rejects a transaction whose txid moved", () => {
    const tx = btc.Transaction.fromHex(F.signedRevealTxHex);
    tx.outs[0].value = 1n;
    expect(() => assertSignedReveal(tx.toHex(), verified)).toThrow(/txid/);
    expect(() => assertSignedReveal("nothex", verified)).toThrow(/not valid hex/);
  });
});

describe("signReveal with an external signer", () => {
  it("hands the signer a one-input script-path PSBT and refuses garbage back", async () => {
    const seen: string[] = [];
    const signer: Signer = {
      getAddresses: () => ({
        p2wpkh: F.sourceAddress,
        publicKey: Buffer.from(
          ECPair.fromPrivateKey(Buffer.from(TEST_PRIVATE_KEY_HEX, "hex")).publicKey,
        ).toString("hex"),
      }),
      signPsbtHex: vi.fn(async (hex: string) => {
        seen.push(hex);
        // A wallet that signs nothing: finalizing fails.
        return hex;
      }),
      signMessage: async () => "sig",
    };
    await expect(
      signReveal({
        revealTxHex: F.revealTxHex,
        material: MATERIAL,
        commitTxHex: F.commitTxHex,
        signer,
        network,
      }),
    ).rejects.toThrow();

    const psbt = btc.Psbt.fromHex(seen[0], { network });
    expect(psbt.data.inputs).toHaveLength(1);
    const input = psbt.data.inputs[0];
    expect(input.tapLeafScript).toHaveLength(1);
    expect(input.tapLeafScript![0].leafVersion).toBe(0xc0);
    expect(Buffer.from(input.tapLeafScript![0].script).toString("hex")).toBe(
      F.envelopeScript,
    );
    expect(Buffer.from(input.tapLeafScript![0].controlBlock).toString("hex")).toBe(
      F.controlBlock,
    );
    expect(Buffer.from(input.tapInternalKey!).toString("hex")).toBe(F.xOnlyPubkey);
    expect(Buffer.from(input.witnessUtxo!.script).toString("hex")).toBe(F.lockScript);
    expect(input.witnessUtxo!.value).toBe(5000n);
    expect(psbt.txOutputs).toHaveLength(1);
    expect(signer.signPsbtHex).toHaveBeenCalledWith(seen[0], [0]);
  });
});

describe("buildRevealPsbt", () => {
  it("wraps the unsigned reveal without changing its txid", () => {
    const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);
    const psbt = buildRevealPsbt(verified, network);
    expect(unsignedTxHexFromPsbt(psbt.toHex())).toBe(F.revealTxHex);
  });
});

describe("envelopeSigningKey", () => {
  it("reads the key of a canonical envelope, including number pushes inside", () => {
    const key = Buffer.from(F.xOnlyPubkey, "hex");
    const script = btc.script.compile([
      btc.opcodes.OP_0,
      btc.opcodes.OP_IF,
      Buffer.from("ord", "ascii"),
      btc.opcodes.OP_1,
      Buffer.from("text/plain", "ascii"),
      btc.opcodes.OP_0,
      Buffer.alloc(40, 7),
      btc.opcodes.OP_ENDIF,
      key,
      btc.opcodes.OP_CHECKSIG,
    ]);
    expect(envelopeSigningKey(script)?.equals(key)).toBe(true);
  });

  it("rejects anything else", () => {
    const key = Buffer.from(F.xOnlyPubkey, "hex");
    const cases: Array<Array<number | Buffer>> = [
      [key, btc.opcodes.OP_CHECKSIG], // bare key
      [btc.opcodes.OP_1, btc.opcodes.OP_IF, Buffer.alloc(3), btc.opcodes.OP_ENDIF, key, btc.opcodes.OP_CHECKSIG],
      [btc.opcodes.OP_0, btc.opcodes.OP_IF, Buffer.alloc(3), btc.opcodes.OP_ENDIF, key, btc.opcodes.OP_CHECKSIGVERIFY],
      [btc.opcodes.OP_0, btc.opcodes.OP_IF, Buffer.alloc(3), btc.opcodes.OP_ENDIF, Buffer.alloc(33, 2), btc.opcodes.OP_CHECKSIG],
      [btc.opcodes.OP_0, btc.opcodes.OP_IF, Buffer.alloc(3), btc.opcodes.OP_ENDIF, btc.opcodes.OP_DROP, key, btc.opcodes.OP_CHECKSIG],
      [btc.opcodes.OP_0, btc.opcodes.OP_IF, btc.opcodes.OP_NOP, btc.opcodes.OP_ENDIF, key, btc.opcodes.OP_CHECKSIG],
      [btc.opcodes.OP_0, btc.opcodes.OP_IF, Buffer.alloc(3), key, btc.opcodes.OP_CHECKSIG], // no OP_ENDIF
    ];
    for (const chunks of cases) {
      expect(envelopeSigningKey(btc.script.compile(chunks))).toBeNull();
    }
    expect(envelopeSigningKey(Buffer.from([0x4c]))).toBeNull(); // truncated push
  });
});

describe("carriesInlineCounterpartyData", () => {
  it("is false for a commit and for a plain payment", () => {
    expect(carriesInlineCounterpartyData(F.commitTxHex)).toBe(false);
    expect(carriesInlineCounterpartyData(revealFixtureCommitPsbtHex())).toBe(false);
    expect(carriesInlineCounterpartyData(FIXTURE_PSBT_HEX)).toBe(false);
  });

  it("is true for an OP_RETURN or a bare multisig data output", () => {
    const psbt = new btc.Psbt({ network });
    psbt.addInput({ hash: "a".repeat(64), index: 0 });
    psbt.addOutput({
      script: btc.script.compile([btc.opcodes.OP_RETURN, Buffer.alloc(40, 1)]),
      value: 0n,
    });
    expect(carriesInlineCounterpartyData(psbt.toHex())).toBe(true);

    const pk = () => Buffer.from(ECPair.makeRandom().publicKey);
    const multisig = new btc.Transaction();
    multisig.addInput(Buffer.alloc(32, 1), 0);
    multisig.addOutput(
      btc.script.compile([btc.opcodes.OP_1, pk(), pk(), pk(), btc.opcodes.OP_3, btc.opcodes.OP_CHECKMULTISIG]),
      7800n,
    );
    expect(carriesInlineCounterpartyData(multisig.toHex())).toBe(true);
  });
});

describe("helpers", () => {
  it("toXOnlyHex strips the parity byte of a compressed key", () => {
    expect(toXOnlyHex(`02${"a".repeat(64)}`)).toBe("a".repeat(64));
    expect(toXOnlyHex("A".repeat(64))).toBe("a".repeat(64));
  });

  it("taprootOutputKeyHex tweaks a valid key and returns null otherwise", () => {
    expect(taprootOutputKeyHex(F.xOnlyPubkey)).toMatch(/^[0-9a-f]{64}$/);
    expect(taprootOutputKeyHex("00".repeat(32))).toBeNull();
    expect(taprootOutputKeyHex("abcd")).toBeNull();
  });

  it("tapleafHash encodes the script length as a compact size", () => {
    const big = Buffer.alloc(300, 0x51);
    const expected = btc.crypto.taggedHash(
      "TapLeaf",
      Buffer.concat([Buffer.from([0xc0, 0xfd, 0x2c, 0x01]), big]),
    );
    expect(tapleafHash(big).equals(Buffer.from(expected))).toBe(true);
  });

  it("PresignedRevealError names the context and the fix", () => {
    const err = new PresignedRevealError("The creation quote");
    expect(err.name).toBe("PresignedRevealError");
    expect(err.message).toMatch(/^The creation quote carries a reveal/);
    expect(err.message).toMatch(/require_reveal_source_signature/);
    expect(new RevealVerificationError("x").message).toBe("Reveal verification failed: x");
  });
});
