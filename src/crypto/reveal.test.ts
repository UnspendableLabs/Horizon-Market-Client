import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { ecc, ECPair } from "./ecc.js";
import { LocalSigner, HDSigner, type Signer } from "./signer.js";
import {
  assertCommitUnchanged,
  assertSignedReveal,
  buildRevealPsbt,
  carriesInlineCounterpartyData,
  envelopeSigningKey,
  PresignedRevealError,
  readRevealCommit,
  revealToSign,
  RevealVerificationError,
  signerKeys,
  signReveal,
  signVerifiedReveal,
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
/** scriptPubKey of an address, hex. */
function scriptOf(address: string): string {
  return Buffer.from(btc.address.toOutputScript(address, network)).toString("hex");
}
/** The fixture's source: the P2WPKH of `TEST_PRIVATE_KEY_HEX`. */
const SOURCE = scriptOf(F.sourceAddress);
const OPTIONS = {
  commitTxHex: F.commitTxHex,
  sourceScriptPubkey: SOURCE,
  expectedKeys: [F.xOnlyPubkey],
};

/** A key pair from a private key given as a repeated hex digit. */
function keyOf(digit: string, compressed = true) {
  return ECPair.fromPrivateKey(Buffer.from(digit.repeat(64), "hex"), { compressed });
}

/** x-only key of a private key given as a repeated hex digit. */
function xOnlyOf(digit: string): string {
  return Buffer.from(keyOf(digit).publicKey.subarray(1, 33)).toString("hex");
}

/** BIP86 output key of an x-only internal key. */
function outputKeyOf(xOnlyHex: string): string {
  const { pubkey } = btc.payments.p2tr({ internalPubkey: Buffer.from(xOnlyHex, "hex") });
  return Buffer.from(pubkey!).toString("hex");
}

function hexOf(script: Uint8Array | undefined): string {
  return Buffer.from(script!).toString("hex");
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
      ...readRevealCommit(revealFixtureCommitPsbtHex()),
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
  const segwitSource = scriptOf(addresses.p2wpkh);
  const taprootSource = scriptOf(addresses.p2tr!);

  it("signs a leaf closed by the BIP84 (segwit) key — a P2WPKH source", async () => {
    const pair = buildRevealPair(toXOnlyHex(addresses.publicKey));
    const signed = await signReveal({
      ...pair,
      sourceScriptPubkey: segwitSource,
      signer,
      network,
    });
    expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
  });

  it("signs a leaf closed by the BIP86 internal key — a P2TR source with its key known", async () => {
    const pair = buildRevealPair(addresses.xOnlyPubkey!);
    const signed = await signReveal({
      ...pair,
      sourceScriptPubkey: taprootSource,
      signer,
      network,
    });
    expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
  });

  it("signs a leaf closed by the P2TR output key — the composer's fallback", async () => {
    const outputKey = outputKeyOf(addresses.xOnlyPubkey!);
    const pair = buildRevealPair(outputKey);
    const signed = await signReveal({
      ...pair,
      sourceScriptPubkey: taprootSource,
      signer,
      network,
    });
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
    // A stranger's envelope over the stranger's own address: the node would
    // take it, but this wallet cannot sign it.
    const stranger = ECPair.makeRandom();
    const pair = buildRevealPair(Buffer.from(stranger.publicKey.subarray(1, 33)).toString("hex"));
    const strangerSource = hexOf(btc.payments.p2wpkh({ pubkey: stranger.publicKey }).output);
    await expect(
      signReveal({ ...pair, sourceScriptPubkey: strangerSource, signer, network }),
    ).rejects.toThrow(/key this wallet does not hold/);
  });

  it("refuses a leaf closed by its own BIP86 key when the BIP84 address funds the commit", async () => {
    // Both keys are the wallet's, but the node attributes the reveal to the
    // funding address only: signing would lose the message.
    const pair = buildRevealPair(addresses.xOnlyPubkey!);
    const signPsbtHex = vi.spyOn(signer, "signPsbtHex");
    await expect(
      signReveal({ ...pair, sourceScriptPubkey: segwitSource, signer, network }),
    ).rejects.toThrow(/not one of the address funding the commit/);
    expect(signPsbtHex).not.toHaveBeenCalled();
    signPsbtHex.mockRestore();
  });
});

// `source_controls_key` in counterparty-rs/src/reveal.rs, case for case.
describe("verifyReveal — the envelope key belongs to the commit's source", () => {
  // Private keys whose compressed public key has each parity.
  const even = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].find(
    (d) => keyOf(d).publicKey[0] === 0x02,
  )!;
  const odd = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].find(
    (d) => keyOf(d).publicKey[0] === 0x03,
  )!;

  function accepts(digitOrKey: string, source: Uint8Array | string): boolean {
    const xOnly = digitOrKey.length === 1 ? xOnlyOf(digitOrKey) : digitOrKey;
    const pair = buildRevealPair(xOnly);
    try {
      verifyReveal(pair.revealTxHex, pair.material, {
        commitTxHex: pair.commitTxHex,
        sourceScriptPubkey: typeof source === "string" ? source : hexOf(source),
      });
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(RevealVerificationError);
      expect((error as Error).message).toMatch(/not one of the address funding the commit/);
      return false;
    }
  }

  it("P2WPKH: the compressed key behind the hash, whatever its parity", () => {
    for (const digit of [even, odd]) {
      const source = btc.payments.p2wpkh({ pubkey: keyOf(digit).publicKey }).output!;
      expect(accepts(digit, source)).toBe(true);
    }
    const other = btc.payments.p2wpkh({ pubkey: keyOf("a").publicKey }).output!;
    expect(accepts(even, other)).toBe(false);
  });

  it("P2SH: a nested P2WPKH of the key, and nothing else", () => {
    for (const digit of [even, odd]) {
      const nested = btc.payments.p2sh({
        redeem: btc.payments.p2wpkh({ pubkey: keyOf(digit).publicKey }),
      }).output!;
      expect(accepts(digit, nested)).toBe(true);
    }
    const multisigP2sh = btc.payments.p2sh({
      redeem: btc.payments.p2ms({ m: 1, pubkeys: [keyOf(even).publicKey] }),
    }).output!;
    expect(accepts(even, multisigP2sh)).toBe(false);
  });

  it("P2PKH: the compressed or the uncompressed key", () => {
    for (const digit of [even, odd]) {
      for (const compressed of [true, false]) {
        const source = btc.payments.p2pkh({
          pubkey: keyOf(digit, compressed).publicKey,
        }).output!;
        expect(accepts(digit, source)).toBe(true);
      }
    }
  });

  it("P2TR: the output key itself, or the internal key it is the BIP86 tweak of", () => {
    const internal = xOnlyOf(even);
    const bip86 = btc.payments.p2tr({ internalPubkey: Buffer.from(internal, "hex") }).output!;
    expect(accepts(internal, bip86)).toBe(true);
    expect(accepts(outputKeyOf(internal), bip86)).toBe(true);
    // A tree with scripts is not a BIP86 tweak: only the output key itself.
    const leaf = btc.script.compile([Buffer.from(internal, "hex"), btc.opcodes.OP_CHECKSIG]);
    const scripted = btc.payments.p2tr({
      internalPubkey: Buffer.from(internal, "hex"),
      scriptTree: { output: leaf },
    });
    expect(accepts(internal, scripted.output!)).toBe(false);
    expect(accepts(hexOf(scripted.pubkey), scripted.output!)).toBe(true);
  });

  it("no single key controls any other source", () => {
    const key = keyOf(even).publicKey;
    const sources = [
      btc.payments.p2wsh({ redeem: btc.payments.p2ms({ m: 1, pubkeys: [key] }) }).output!,
      btc.payments.p2ms({ m: 1, pubkeys: [key] }).output!,
      btc.payments.p2pk({ pubkey: key }).output!,
      btc.script.compile([btc.opcodes.OP_RETURN, Buffer.alloc(20)]),
    ];
    for (const source of sources) expect(accepts(even, source)).toBe(false);
  });

  it("a key off the curve is no one's key", () => {
    // x = 0 is not on secp256k1: the node refuses it as InvalidLeafKey.
    const offCurve = Buffer.alloc(32);
    const envelope = btc.script.compile([
      btc.opcodes.OP_0,
      btc.opcodes.OP_IF,
      Buffer.alloc(8, 1),
      btc.opcodes.OP_ENDIF,
      offCurve,
      btc.opcodes.OP_CHECKSIG,
    ]);
    const material = {
      ...MATERIAL,
      envelopeScript: hexOf(envelope),
      pubkey: offCurve.toString("hex"),
    };
    expect(() =>
      verifyReveal(F.revealTxHex, material, {
        commitTxHex: F.commitTxHex,
        sourceScriptPubkey: hexOf(btc.payments.p2tr({ pubkey: Buffer.from(F.xOnlyPubkey, "hex") }).output),
      }),
    ).toThrow(/not one of the address funding the commit/);
  });

  it("rejects a source that is not hex", () => {
    expect(() =>
      verifyReveal(F.revealTxHex, MATERIAL, { ...OPTIONS, sourceScriptPubkey: "zz" }),
    ).toThrow(/source scriptPubKey is not valid hex/);
  });
});

describe("verifyReveal", () => {
  it("returns the parsed pieces", () => {
    const verified = verifyReveal(F.revealTxHex, MATERIAL, OPTIONS);
    expect(verified.commitTxid).toBe(F.commitTxid);
    expect(verified.revealTxid).toBe(F.revealTxid);
    expect(verified.inputValue).toBe(5000n);
  });

  it("hashes the leaf as BIP341 does, compact size included", () => {
    // Past 252 bytes the script length takes a 0xfd-prefixed compact size.
    const pair = buildRevealPair(F.xOnlyPubkey, { data: Buffer.alloc(400, 7) });
    const envelope = Buffer.from(pair.material.envelopeScript, "hex");
    expect(envelope.length).toBeGreaterThan(0xfc);
    const size = Buffer.alloc(3);
    size[0] = 0xfd;
    size.writeUInt16LE(envelope.length, 1);
    const expected = btc.crypto.taggedHash(
      "TapLeaf",
      Buffer.concat([Buffer.from([0xc0]), size, envelope]),
    );
    const verified = verifyReveal(pair.revealTxHex, pair.material, {
      commitTxHex: pair.commitTxHex,
    });
    expect(verified.leafHash.equals(Buffer.from(expected))).toBe(true);
  });

  it("accepts a compressed key in expectedKeys", () => {
    const compressed = ECPair.fromPrivateKey(
      Buffer.from(TEST_PRIVATE_KEY_HEX, "hex"),
    ).publicKey;
    expect(() =>
      verifyReveal(F.revealTxHex, MATERIAL, {
        ...OPTIONS,
        expectedKeys: [Buffer.from(compressed).toString("hex")],
      }),
    ).not.toThrow();
  });

  it("takes expectedKeys literally: a key's BIP86 tweak must be listed too", () => {
    const internal = xOnlyOf("e");
    const pair = buildRevealPair(outputKeyOf(internal));
    const options = { commitTxHex: pair.commitTxHex };
    expect(() =>
      verifyReveal(pair.revealTxHex, pair.material, { ...options, expectedKeys: [internal] }),
    ).toThrow(/key this wallet does not hold/);
    expect(() =>
      verifyReveal(pair.revealTxHex, pair.material, {
        ...options,
        expectedKeys: [internal, outputKeyOf(internal)],
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

describe("signerKeys", () => {
  it("lists a single-key wallet's key and its BIP86 output key", () => {
    const addresses = new LocalSigner(TEST_PRIVATE_KEY_HEX).getAddresses();
    expect(signerKeys(addresses).sort()).toEqual(
      [F.xOnlyPubkey, outputKeyOf(F.xOnlyPubkey)].sort(),
    );
  });

  it("lists an HD wallet's segwit key, taproot key and taproot output key — not the segwit tweak", () => {
    const addresses = new HDSigner({
      segwitKeyHex: TEST_PRIVATE_KEY_HEX,
      taprootKeyHex: "2".repeat(64),
    }).getAddresses();
    const keys = signerKeys(addresses);
    expect(keys.sort()).toEqual(
      [
        toXOnlyHex(addresses.publicKey),
        addresses.xOnlyPubkey!,
        outputKeyOf(addresses.xOnlyPubkey!),
      ].sort(),
    );
    expect(keys).not.toContain(outputKeyOf(toXOnlyHex(addresses.publicKey)));
  });

  it("leaves out anything that is not a public key", () => {
    expect(signerKeys({ publicKey: "" })).toEqual([]);
    expect(signerKeys({ publicKey: "02aabbcc" })).toEqual([]);
    expect(signerKeys({ publicKey: `02${"00".repeat(32)}`, xOnlyPubkey: "00".repeat(32) })).toEqual([]);
    expect(signerKeys({ publicKey: "", xOnlyPubkey: F.xOnlyPubkey.toUpperCase() })).toEqual([
      F.xOnlyPubkey,
      outputKeyOf(F.xOnlyPubkey),
    ]);
  });

  // `signerKeys` is what a reveal is checked against before the wallet is
  // prompted, and `signPsbtHexWithKeys` what signs it: they must agree, or a
  // quote passes the check and then fails after the commit prompt.
  it("agrees with what the HD signer can actually sign", async () => {
    const signer = new HDSigner({
      segwitKeyHex: TEST_PRIVATE_KEY_HEX,
      taprootKeyHex: "3".repeat(64),
    });
    const addresses = signer.getAddresses();
    for (const key of signerKeys(addresses)) {
      const pair = buildRevealPair(key);
      const verified = verifyReveal(pair.revealTxHex, pair.material, {
        commitTxHex: pair.commitTxHex,
        expectedKeys: signerKeys(addresses),
      });
      const signed = await signVerifiedReveal(verified, signer, network);
      expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
    }
    // The one tweak it cannot sign with is refused by the check itself.
    const segwitTweak = buildRevealPair(outputKeyOf(toXOnlyHex(addresses.publicKey)));
    expect(() =>
      verifyReveal(segwitTweak.revealTxHex, segwitTweak.material, {
        commitTxHex: segwitTweak.commitTxHex,
        expectedKeys: signerKeys(addresses),
      }),
    ).toThrow(/key this wallet does not hold/);
  });
});

describe("readRevealCommit", () => {
  const p2wpkh = btc.address.toOutputScript(F.sourceAddress, network);

  /** A one-output transaction paying `script` at index 1 — a prevout. */
  function previousPaying(script: Uint8Array): btc.Transaction {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 0x11), 0);
    tx.addOutput(Buffer.from([btc.opcodes.OP_RETURN]), 0n);
    tx.addOutput(Buffer.from(script), 100_000n);
    return tx;
  }

  /** The fixture commit, its inputs spending `previous:1` with `utxo` data. */
  function commitSpending(
    previous: btc.Transaction,
    utxo: { witness?: boolean; nonWitness?: Uint8Array },
  ): string {
    const commit = btc.Transaction.fromHex(F.commitTxHex);
    const psbt = new btc.Psbt({ network });
    psbt.addInput({
      hash: Buffer.from(previous.getHash()),
      index: 1,
      ...(utxo.witness ? { witnessUtxo: { script: previous.outs[1].script, value: 100_000n } } : {}),
      ...(utxo.nonWitness ? { nonWitnessUtxo: utxo.nonWitness } : {}),
    });
    for (const out of commit.outs) psbt.addOutput({ script: out.script, value: out.value });
    return psbt.toHex();
  }

  it("reads the unsigned commit and the output its input 0 spends", () => {
    expect(readRevealCommit(revealFixtureCommitPsbtHex())).toEqual({
      commitTxHex: F.commitTxHex,
      sourceScriptPubkey: SOURCE,
    });
  });

  it("takes the source from input 0 only", () => {
    const commit = btc.Psbt.fromHex(revealFixtureCommitPsbtHex());
    const taproot = btc.payments.p2tr({ internalPubkey: Buffer.from(xOnlyOf("5"), "hex") }).output!;
    commit.addInput({ hash: "b".repeat(64), index: 0, witnessUtxo: { script: taproot, value: 1000n } });
    expect(readRevealCommit(commit.toHex()).sourceScriptPubkey).toBe(SOURCE);
  });

  it("reads a segwit prevout from nonWitnessUtxo, when it is the spent transaction", () => {
    const previous = previousPaying(p2wpkh);
    expect(
      readRevealCommit(commitSpending(previous, { nonWitness: previous.toBuffer() }))
        .sourceScriptPubkey,
    ).toBe(SOURCE);
    // A nonWitnessUtxo that is some other transaction proves nothing.
    const decoy = previousPaying(p2wpkh);
    decoy.locktime = 1;
    const psbt = btc.Psbt.fromHex(commitSpending(previous, {}));
    psbt.data.inputs[0].nonWitnessUtxo = decoy.toBuffer();
    expect(() => readRevealCommit(psbt.toHex())).toThrow(/carries no prevout/);
  });

  it("refuses an input without its prevout", () => {
    const previous = previousPaying(p2wpkh);
    expect(() => readRevealCommit(commitSpending(previous, {}))).toThrow(
      /input 0 of the commit carries no prevout/,
    );
  });

  it("refuses an input whose signature would move the commit's txid", () => {
    const pubkey = keyOf("6").publicKey;
    const legacy = [
      btc.payments.p2pkh({ pubkey }).output!,
      btc.payments.p2sh({ redeem: btc.payments.p2wpkh({ pubkey }) }).output!,
    ];
    for (const script of legacy) {
      const previous = previousPaying(script);
      expect(() =>
        readRevealCommit(commitSpending(previous, { nonWitness: previous.toBuffer() })),
      ).toThrow(/input 0 of the commit does not spend a native segwit output/);
    }
    // Any input, not only the source.
    const commit = btc.Psbt.fromHex(revealFixtureCommitPsbtHex());
    commit.addInput({
      hash: "c".repeat(64),
      index: 0,
      witnessUtxo: { script: legacy[1], value: 1000n },
    });
    expect(() => readRevealCommit(commit.toHex())).toThrow(/input 1 of the commit/);
  });

  it("refuses what is not a PSBT, trailing garbage included", () => {
    expect(() => readRevealCommit(F.commitTxHex)).toThrow(/not a valid PSBT/);
    // `Buffer.from(hex)` would stop at the garbage and parse the PSBT before it.
    expect(() => readRevealCommit(`${revealFixtureCommitPsbtHex()}zz`)).toThrow(
      /not a valid PSBT/,
    );
  });
});

describe("assertCommitUnchanged", () => {
  const quoted = revealFixtureCommitPsbtHex();

  it("passes the quoted commit, signed or not", () => {
    const signed = new LocalSigner(TEST_PRIVATE_KEY_HEX).signPsbtHex(quoted, [0]);
    expect(() => assertCommitUnchanged(quoted, quoted)).not.toThrow();
    expect(() => assertCommitUnchanged(quoted, signed)).not.toThrow();
  });

  it("refuses a commit whose transaction changed, and what is not a PSBT", () => {
    const moved = btc.Psbt.fromHex(quoted);
    moved.setLocktime(1);
    expect(() => assertCommitUnchanged(quoted, moved.toHex())).toThrow(
      RevealVerificationError,
    );
    expect(() => assertCommitUnchanged(quoted, moved.toHex())).toThrow(
      /changed the commit while signing it/,
    );
    expect(() => assertCommitUnchanged(quoted, `${quoted}_signed`)).toThrow(
      /something other than a PSBT/,
    );
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
  const compressedKey = Buffer.from(
    ECPair.fromPrivateKey(Buffer.from(TEST_PRIVATE_KEY_HEX, "hex")).publicKey,
  ).toString("hex");

  function wallet(sign: (psbtHex: string) => string): Signer {
    return {
      getAddresses: () => ({ p2wpkh: F.sourceAddress, publicKey: compressedKey }),
      signPsbtHex: vi.fn(async (hex: string) => sign(hex)),
      signMessage: async () => "sig",
    };
  }
  const params = {
    revealTxHex: F.revealTxHex,
    material: MATERIAL,
    commitTxHex: F.commitTxHex,
    sourceScriptPubkey: SOURCE,
    network,
  };

  it("hands the signer a one-input script-path PSBT and refuses garbage back", async () => {
    const seen: string[] = [];
    // A wallet that signs nothing: there is no reveal to finalize.
    const signer = wallet((hex) => {
      seen.push(hex);
      return hex;
    });
    await expect(signReveal({ ...params, signer })).rejects.toThrow(
      /did not return a signed reveal/,
    );

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

  it("accepts a reveal the wallet finalized itself", async () => {
    const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const signer = wallet((hex) => {
      const signed = btc.Psbt.fromHex(local.signPsbtHex(hex, [0]));
      signed.finalizeAllInputs();
      return signed.toHex();
    });
    const signed = await signReveal({ ...params, signer });
    expect(signed.revealTxid).toBe(F.revealTxid);
    expect(witnessOf(signed.revealTxHex)).toHaveLength(3);
  });

  it("still checks a witness the wallet finalized", async () => {
    // Finalized with a signature that is not the envelope key's: caught, not
    // broadcast — skipping the finalizer must not skip the check.
    const serialize = (items: Buffer[]): Buffer => {
      const size = (n: number) =>
        n < 0xfd ? Buffer.from([n]) : Buffer.from([0xfd, n & 0xff, n >> 8]);
      return Buffer.concat([
        size(items.length),
        ...items.flatMap((item) => [size(item.length), item]),
      ]);
    };
    const [, envelope, controlBlock] = witnessOf(F.signedRevealTxHex);
    const signer = wallet((hex) => {
      const psbt = btc.Psbt.fromHex(hex);
      psbt.updateInput(0, {
        finalScriptWitness: serialize([Buffer.alloc(64, 1), envelope, controlBlock]),
      });
      return psbt.toHex();
    });
    await expect(signReveal({ ...params, signer })).rejects.toThrow(/does not verify/);
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
  /** A transaction with one output per script. */
  function paying(...scripts: Uint8Array[]): string {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    for (const script of scripts) tx.addOutput(Buffer.from(script), 1000n);
    return tx.toHex();
  }
  const pk = (length = 33) => Buffer.concat([Buffer.from([0x02]), Buffer.alloc(length - 1, 9)]);

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

    const { OP_1, OP_2, OP_3, OP_CHECKMULTISIG } = btc.opcodes;
    for (const multisig of [
      [OP_1, pk(), pk(), pk(), OP_3, OP_CHECKMULTISIG],
      [OP_1, pk(), pk(), OP_2, OP_CHECKMULTISIG],
      [OP_1, pk(65), pk(33), OP_2, OP_CHECKMULTISIG],
    ]) {
      expect(carriesInlineCounterpartyData(paying(btc.script.compile(multisig)))).toBe(true);
    }
  });

  it("is not fooled by a hash or key that happens to end in 0xae (OP_CHECKMULTISIG)", () => {
    const tail = (prefix: number[], length: number) =>
      Buffer.concat([Buffer.from(prefix), Buffer.alloc(length - 1, 0x42), Buffer.from([0xae])]);
    expect(
      carriesInlineCounterpartyData(
        paying(
          tail([0x00, 0x14], 20), // P2WPKH
          tail([0x00, 0x20], 32), // P2WSH
          tail([0x51, 0x20], 32), // P2TR — a commit's envelope output, say
        ),
      ),
    ).toBe(false);
  });

  it("wants the whole multisig shape", () => {
    const { OP_1, OP_2, OP_3, OP_CHECKMULTISIG } = btc.opcodes;
    for (const almost of [
      [OP_1, pk(), OP_3, OP_CHECKMULTISIG], // n says 3, one key
      [OP_3, pk(), pk(), OP_2, OP_CHECKMULTISIG], // m > n
      [OP_1, pk(20), pk(), OP_2, OP_CHECKMULTISIG], // not a key
      [OP_1, pk(), pk(), OP_2, OP_CHECKMULTISIG, OP_1], // trailing opcode
      [pk(), pk(), OP_2, OP_CHECKMULTISIG], // no m
    ]) {
      expect(carriesInlineCounterpartyData(paying(btc.script.compile(almost)))).toBe(false);
    }
  });
});

describe("revealToSign", () => {
  it("pairs a reveal with its material, and answers null when there is neither", () => {
    expect(revealToSign("The quote", null, null)).toBeNull();
    expect(revealToSign("The quote", undefined, undefined)).toBeNull();
    expect(revealToSign("The quote", F.revealTxHex, MATERIAL)).toEqual({
      revealTxHex: F.revealTxHex,
      material: MATERIAL,
    });
  });

  it("refuses one without the other", () => {
    expect(() => revealToSign("The sell quote", F.revealTxHex, null)).toThrow(
      PresignedRevealError,
    );
    expect(() => revealToSign("The sell quote", F.revealTxHex, null)).toThrow(
      /^The sell quote carries a reveal/,
    );
    expect(() => revealToSign("The quote", null, MATERIAL)).toThrow(
      /The quote carries reveal signing material but no reveal transaction/,
    );
  });
});

describe("helpers", () => {
  it("toXOnlyHex strips the parity byte of a compressed key", () => {
    expect(toXOnlyHex(`02${"a".repeat(64)}`)).toBe("a".repeat(64));
    expect(toXOnlyHex("A".repeat(64))).toBe("a".repeat(64));
  });

  it("PresignedRevealError names the context and the fix", () => {
    const err = new PresignedRevealError("The creation quote");
    expect(err.name).toBe("PresignedRevealError");
    expect(err.message).toMatch(/^The creation quote carries a reveal/);
    expect(err.message).toMatch(/require_reveal_source_signature/);
    expect(new RevealVerificationError("x").message).toBe("Reveal verification failed: x");
  });
});
