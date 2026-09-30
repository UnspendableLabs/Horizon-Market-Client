import * as btc from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { finalizePsbtHex } from "./psbt-finalize.js";
import type { Signer } from "./signer.js";

/**
 * Wallet-side signing of a Counterparty taproot **reveal**.
 *
 * A Counterparty message too large for an `OP_RETURN` travels in a taproot
 * envelope: a *commit* transaction pays a P2TR output whose single script leaf
 * holds the data, and a *reveal* transaction spends that output through the leaf.
 * Since Counterparty Core v11.5.0 (`require_reveal_source_signature`) the node
 * attributes a reveal to the address that funded the commit **only when the
 * leaf is closed by a key of that address and the reveal is signed with it**.
 * The node therefore no longer signs the reveal; it hands back the unsigned
 * reveal plus everything needed to sign it, and the wallet adds the witness
 * `<signature> <envelope_script> <control_block>`.
 *
 * A reveal built the old way (closed by a throwaway key) is still a valid
 * Bitcoin transaction — it just carries no Counterparty message any more. The
 * commit's fees are paid and the message is silently lost, which is why every
 * entry point here refuses to touch a pre-signed reveal it cannot vouch for.
 */

// bitcoinjs needs a secp256k1 backend for `payments.p2tr`; `ecc.ts` installs
// the same one but also runs the ECPair self-test at import time, which this
// module avoids so the creation workflow can be imported without it. Installed
// on first use instead — `initEccLib` is idempotent for the same backend.
let eccInstalled = false;
function ensureEccLib(): void {
  if (eccInstalled) return;
  btc.initEccLib(ecc);
  eccInstalled = true;
}

/** Tapscript leaf version — the only one the Counterparty parser accepts. */
export const TAPSCRIPT_LEAF_VERSION = 0xc0;

/** `CNTRPRTY`, the prefix of every Counterparty `OP_RETURN` output. */
const CNTRPRTY_PREFIX = Buffer.from("434e545250525459", "hex");

/**
 * What the composer returns alongside the unsigned reveal, camel-cased. The
 * wire names are Counterparty Core's (`envelope_script`, `reveal_control_block`,
 * `reveal_pubkey`, `reveal_lock_scripts[0]`, `reveal_inputs_values[0]`), and the
 * Horizon Market API passes them through untouched.
 */
export interface RevealSigningMaterial {
  /**
   * Hex tapscript leaf: `OP_FALSE OP_IF <data pushes> OP_ENDIF <x-only key>
   * OP_CHECKSIG`. The data is the Counterparty message.
   */
  envelopeScript: string;
  /** Hex control block of the single-leaf tree (leaf version `0xc0`). */
  controlBlock: string;
  /** Hex x-only key that closes the envelope — a key of the source address. */
  pubkey: string;
  /** Hex scriptPubKey of the commit output the reveal spends (`commit:0`). */
  lockScript: string;
  /** Value in sats of that commit output. */
  inputValue: number;
}

/** A reveal signed and ready to broadcast after its commit. */
export interface SignedReveal {
  revealTxHex: string;
  revealTxid: string;
}

/**
 * Thrown when a quote carries a reveal that this wallet did not — and cannot —
 * sign: a server running Counterparty Core < 11.5.0, or a Horizon Market server
 * not yet forwarding the signing material, pre-signed it with a throwaway key.
 * The network ignores such a reveal, so broadcasting the pair would pay the fees
 * and lose the message. Nothing is signed or sent.
 */
export class PresignedRevealError extends Error {
  constructor(context: string) {
    super(
      `${context} carries a reveal transaction pre-signed by the server. Since ` +
        "Counterparty Core v11.5.0 (require_reveal_source_signature) a reveal " +
        "not signed by the source address is ignored by the network, so " +
        "broadcasting it would pay the fees and lose the message. Nothing was " +
        "signed. The server must be updated to return the unsigned reveal with " +
        "its signing material (envelope_script, reveal_control_block, " +
        "reveal_pubkey, reveal_lock_scripts, reveal_inputs_values).",
    );
    this.name = "PresignedRevealError";
  }
}

/**
 * Thrown when the reveal, its signing material and the commit disagree: the
 * envelope is not canonical, is closed by a key that is not the commit funder's
 * or not ours, does not hash to the commit output, the reveal does not spend
 * `commit:0`, or the commit's txid can move before it is broadcast. Signing
 * would either produce a reveal the network ignores or authorize spending
 * something we did not compose — so nothing is signed.
 */
export class RevealVerificationError extends Error {
  constructor(message: string) {
    super(`Reveal verification failed: ${message}`);
    this.name = "RevealVerificationError";
  }
}

/** Parsed, verified pieces of a reveal, ready to build a PSBT from. */
export interface VerifiedReveal {
  reveal: btc.Transaction;
  revealTxid: string;
  commitTxid: string;
  envelope: Buffer;
  controlBlock: Buffer;
  lockScript: Buffer;
  inputValue: bigint;
  /** x-only key closing the envelope. */
  pubkey: Buffer;
  /**
   * BIP341 tapleaf hash of the envelope under leaf version `0xc0` — also the
   * merkle root of its single-leaf tree.
   */
  leafHash: Buffer;
}

/**
 * The commit a reveal binds to, as {@link readRevealCommit} reads it off the
 * commit PSBT. Spread it into {@link VerifyRevealOptions} or
 * {@link SignRevealParams}.
 */
export interface RevealCommit {
  /**
   * The commit transaction. Unsigned or signed alike: the reveal binds to its
   * txid, which witness-only signing cannot move. Its output 0 must be the
   * envelope output the material describes.
   */
  commitTxHex: string;
  /**
   * Hex scriptPubKey of the output the commit's input 0 spends: the address the
   * node attributes the reveal to.
   */
  sourceScriptPubkey: string;
}

export interface VerifyRevealOptions {
  /** See {@link RevealCommit.commitTxHex}. */
  commitTxHex: string;
  /**
   * See {@link RevealCommit.sourceScriptPubkey}. The envelope must be closed by
   * a key of that address, under the node's own rule: the output key, or the
   * internal key it is the BIP86 tweak of, for P2TR; the compressed key behind
   * the hash for P2WPKH, nested P2WPKH and P2PKH (uncompressed too for P2PKH).
   * Any other key and the network ignores the reveal. When omitted the check is
   * skipped.
   */
  sourceScriptPubkey?: string;
  /**
   * Keys the wallet can close a leaf with, as hex: x-only (64 chars) or
   * compressed (66 chars, the parity byte is dropped). {@link signerKeys} lists
   * a signer's. The envelope must be closed by one of them — otherwise no key
   * here can produce the signature, and the wallet prompt would be wasted.
   * Taken as given: a key's BIP86 tweak counts only when it is listed too. When
   * omitted the check is skipped.
   */
  expectedKeys?: string[];
}

function hexToBuffer(hex: string, what: string): Buffer {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) {
    throw new RevealVerificationError(`${what} is not valid hex`);
  }
  return Buffer.from(hex, "hex");
}

function txidOf(hash: Uint8Array): string {
  return Buffer.from(hash).reverse().toString("hex");
}

/** x-only form of a hex key: compressed keys lose their parity byte. */
export function toXOnlyHex(keyHex: string): string {
  const key = keyHex.toLowerCase();
  return key.length === 66 ? key.slice(2) : key;
}

const PUBKEY_HEX = /^(?:0[23])?[0-9a-fA-F]{64}$/;

/**
 * BIP86 output key of an x-only internal key (tweaked with no script tree) —
 * the key a P2TR address's scriptPubKey carries. `null` off the curve.
 */
function bip86OutputKey(internalKey: Uint8Array): Buffer | null {
  if (!ecc.isXOnlyPoint(internalKey)) return null;
  ensureEccLib();
  return Buffer.from(btc.payments.p2tr({ internalPubkey: internalKey }).pubkey!);
}

const { OPS } = btc.script;

/**
 * Whether the x-only `key` is a key of the address whose scriptPubKey is
 * `source` — the node's `source_controls_key` (`counterparty-rs/src/reveal.rs`),
 * branch for branch. The key is x-only, so both parities of the compressed key
 * are tried. Any other kind of source (bare multisig, P2WSH, …) has no single
 * key that could have consented and never authorizes a reveal.
 */
function isKeyOfSource(key: Buffer, source: Buffer): boolean {
  if (!ecc.isXOnlyPoint(key)) return false;
  const compressed = [0x02, 0x03].map((parity) =>
    Buffer.concat([Buffer.from([parity]), key]),
  );
  const hash160 = (data: Uint8Array) => Buffer.from(btc.crypto.hash160(data));

  // P2TR `OP_1 <32-byte output key>`: the output key itself, or the internal
  // key it is the BIP86 tweak of — a wallet may sign the leaf with either.
  if (source.length === 34 && source[0] === OPS.OP_1 && source[1] === 0x20) {
    const outputKey = source.subarray(2);
    return key.equals(outputKey) || !!bip86OutputKey(key)?.equals(outputKey);
  }
  // P2WPKH `OP_0 <20-byte hash>`.
  if (source.length === 22 && source[0] === OPS.OP_0 && source[1] === 0x14) {
    const program = source.subarray(2);
    return compressed.some((pubkey) => hash160(pubkey).equals(program));
  }
  // P2PKH `OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG`.
  if (
    source.length === 25 &&
    source[0] === OPS.OP_DUP &&
    source[1] === OPS.OP_HASH160 &&
    source[2] === 0x14 &&
    source[23] === OPS.OP_EQUALVERIFY &&
    source[24] === OPS.OP_CHECKSIG
  ) {
    const pubkeyHash = source.subarray(3, 23);
    const uncompressed = compressed.map((pubkey) =>
      Buffer.from(ecc.pointCompress(pubkey, false)),
    );
    return [...compressed, ...uncompressed].some((pubkey) =>
      hash160(pubkey).equals(pubkeyHash),
    );
  }
  // P2SH `OP_HASH160 <20-byte hash> OP_EQUAL`: a nested P2WPKH only.
  if (
    source.length === 23 &&
    source[0] === OPS.OP_HASH160 &&
    source[1] === 0x14 &&
    source[22] === OPS.OP_EQUAL
  ) {
    const scriptHash = source.subarray(2, 22);
    return compressed.some((pubkey) =>
      hash160(Buffer.concat([Buffer.from([0x00, 0x14]), hash160(pubkey)])).equals(
        scriptHash,
      ),
    );
  }
  return false;
}

/**
 * The x-only key closing a canonical Counterparty envelope, or `null` when the
 * script is anything else. Canonical means exactly
 * `OP_FALSE OP_IF <pushes only> OP_ENDIF <32-byte key> OP_CHECKSIG` — the rule
 * the node applies (`counterparty-rs/src/reveal.rs`); anything looser could hide
 * an `OP_SUCCESSx` that makes the leaf spendable without the signature.
 */
export function envelopeSigningKey(envelope: Uint8Array): Buffer | null {
  let chunks: Array<number | Uint8Array> | null;
  try {
    chunks = btc.script.decompile(envelope);
  } catch {
    return null;
  }
  if (!chunks || chunks.length < 5) return null;
  if (chunks[0] !== OPS.OP_0 || chunks[1] !== OPS.OP_IF) return null;
  const checksig = chunks[chunks.length - 1];
  const key = chunks[chunks.length - 2];
  const endif = chunks[chunks.length - 3];
  if (checksig !== OPS.OP_CHECKSIG || endif !== OPS.OP_ENDIF) return null;
  if (typeof key === "number" || key.length !== 32) return null;
  for (const chunk of chunks.slice(2, -3)) {
    if (typeof chunk !== "number") continue; // a data push
    // Number pushes are the only opcodes allowed inside the envelope.
    const isNumberPush =
      chunk === OPS.OP_0 ||
      chunk === OPS.OP_1NEGATE ||
      (chunk >= OPS.OP_1 && chunk <= OPS.OP_16);
    if (!isNumberPush) return null;
  }
  return Buffer.from(key);
}

/** Whether `script` is `OP_RETURN` followed by a push starting with `CNTRPRTY`. */
function isCounterpartyOpReturn(script: Uint8Array): boolean {
  const chunks = btc.script.decompile(script);
  if (!chunks || chunks.length !== 2 || chunks[0] !== OPS.OP_RETURN) return false;
  const data = chunks[1];
  return (
    typeof data !== "number" &&
    data.length >= CNTRPRTY_PREFIX.length &&
    Buffer.from(data.subarray(0, CNTRPRTY_PREFIX.length)).equals(CNTRPRTY_PREFIX)
  );
}

/**
 * Cross-check the unsigned reveal, its signing material and the commit before
 * signing anything. Every check mirrors one the node makes when it attributes
 * the reveal — the envelope key belonging to the commit's funder included, given
 * `sourceScriptPubkey` — plus the two that protect the wallet itself: the
 * envelope is closed by a key *we* hold, and the commit output really is the
 * envelope output.
 *
 * @throws {RevealVerificationError} on the first inconsistency.
 */
export function verifyReveal(
  revealTxHex: string,
  material: RevealSigningMaterial,
  options: VerifyRevealOptions,
): VerifiedReveal {
  ensureEccLib();
  const envelope = hexToBuffer(material.envelopeScript, "envelope_script");
  const controlBlock = hexToBuffer(material.controlBlock, "reveal_control_block");
  const lockScript = hexToBuffer(material.lockScript, "reveal_lock_scripts[0]");
  const pubkey = hexToBuffer(material.pubkey, "reveal_pubkey");
  if (pubkey.length !== 32) {
    throw new RevealVerificationError("reveal_pubkey is not a 32-byte x-only key");
  }
  if (
    !Number.isInteger(material.inputValue) ||
    material.inputValue <= 0
  ) {
    throw new RevealVerificationError(
      "reveal_inputs_values[0] is not a positive integer",
    );
  }
  const inputValue = BigInt(material.inputValue);

  // 1. Canonical envelope, closed by the announced key.
  const leafKey = envelopeSigningKey(envelope);
  if (!leafKey) {
    throw new RevealVerificationError(
      "envelope_script is not a canonical envelope " +
        "(OP_FALSE OP_IF <pushes> OP_ENDIF <key> OP_CHECKSIG)",
    );
  }
  if (!leafKey.equals(pubkey)) {
    throw new RevealVerificationError(
      "envelope_script is closed by a key other than reveal_pubkey",
    );
  }

  // 2. That key is one of the commit funder's — the only one the node accepts —
  //    and one this wallet can sign with.
  if (options.sourceScriptPubkey !== undefined) {
    const source = hexToBuffer(
      options.sourceScriptPubkey,
      "the commit's source scriptPubKey",
    );
    if (!isKeyOfSource(pubkey, source)) {
      throw new RevealVerificationError(
        "the envelope is closed by a key that is not one of the address funding " +
          "the commit (its input 0), so the network would ignore the reveal",
      );
    }
  }
  if (options.expectedKeys) {
    const ours = new Set(options.expectedKeys.map(toXOnlyHex));
    if (!ours.has(pubkey.toString("hex"))) {
      throw new RevealVerificationError(
        "the envelope is closed by a key this wallet does not hold",
      );
    }
  }

  // 3. The commit output commits to exactly this leaf under this internal key,
  //    and the control block is the one that proves it.
  let tree: btc.Payment;
  try {
    tree = btc.payments.p2tr({
      internalPubkey: pubkey,
      scriptTree: { output: envelope },
      redeem: { output: envelope, redeemVersion: TAPSCRIPT_LEAF_VERSION },
    });
  } catch (cause) {
    throw new RevealVerificationError(
      `cannot rebuild the commit output from the envelope: ${String(cause)}`,
    );
  }
  if (!tree.output || !Buffer.from(tree.output).equals(lockScript)) {
    throw new RevealVerificationError(
      "reveal_lock_scripts[0] is not the P2TR output of the envelope under reveal_pubkey",
    );
  }
  const expectedControlBlock = tree.witness?.[tree.witness.length - 1];
  if (
    !expectedControlBlock ||
    !Buffer.from(expectedControlBlock).equals(controlBlock)
  ) {
    throw new RevealVerificationError(
      "reveal_control_block does not match the single-leaf tree of the envelope",
    );
  }
  // A single-leaf tree's merkle root is its leaf hash — the one a script-path
  // signature commits to. Always set: the tree was built from a script.
  const leafHash = Buffer.from(tree.hash!);

  // 4. The commit really pays that output at index 0, for the announced value.
  let commit: btc.Transaction;
  try {
    commit = btc.Transaction.fromHex(options.commitTxHex);
  } catch {
    throw new RevealVerificationError("the commit transaction is not valid hex");
  }
  const commitOut = commit.outs[0];
  if (!commitOut || !Buffer.from(commitOut.script).equals(lockScript)) {
    throw new RevealVerificationError(
      "output 0 of the commit transaction is not the envelope output",
    );
  }
  if (commitOut.value !== inputValue) {
    throw new RevealVerificationError(
      `reveal_inputs_values[0] (${inputValue}) differs from the commit output value (${commitOut.value})`,
    );
  }
  const commitTxid = commit.getId();

  // 5. The reveal spends exactly that output, and nothing else.
  let reveal: btc.Transaction;
  try {
    reveal = btc.Transaction.fromHex(revealTxHex);
  } catch {
    throw new RevealVerificationError("reveal_rawtransaction is not valid hex");
  }
  if (reveal.ins.length !== 1) {
    throw new RevealVerificationError(
      `the reveal has ${reveal.ins.length} inputs; expected exactly one (the commit output)`,
    );
  }
  const input = reveal.ins[0];
  if (txidOf(input.hash) !== commitTxid || input.index !== 0) {
    throw new RevealVerificationError(
      `the reveal spends ${txidOf(input.hash)}:${input.index}, not ${commitTxid}:0`,
    );
  }
  if (input.witness.length > 0 || input.script.length > 0) {
    throw new RevealVerificationError(
      "the reveal is already signed; expected the unsigned transaction",
    );
  }
  if (reveal.outs.length === 0 || !reveal.outs.some((o) => isCounterpartyOpReturn(o.script))) {
    throw new RevealVerificationError(
      "the reveal has no OP_RETURN CNTRPRTY output, so the node would not read it",
    );
  }
  const outTotal = reveal.outs.reduce((sum, o) => sum + o.value, 0n);
  if (outTotal > inputValue) {
    throw new RevealVerificationError(
      "the reveal spends more than the commit output holds",
    );
  }

  return {
    reveal,
    revealTxid: reveal.getId(),
    commitTxid,
    envelope,
    controlBlock,
    lockScript,
    inputValue,
    pubkey,
    leafHash,
  };
}

/** A native witness program: `OP_0`…`OP_16`, then one 2-to-40-byte push (BIP141). */
function isWitnessProgram(script: Uint8Array): boolean {
  const version = script[0];
  return (
    script.length >= 4 &&
    script.length <= 42 &&
    (version === OPS.OP_0 || (version >= OPS.OP_1 && version <= OPS.OP_16)) &&
    script[1] === script.length - 2
  );
}

/** The scriptPubKey a PSBT input spends, from its witnessUtxo or nonWitnessUtxo. */
function prevoutScript(
  input: btc.Psbt["data"]["inputs"][number],
  txInput: btc.PsbtTxInput,
): Uint8Array | null {
  if (input.witnessUtxo) return input.witnessUtxo.script;
  if (!input.nonWitnessUtxo) return null;
  let previous: btc.Transaction;
  try {
    previous = btc.Transaction.fromBuffer(input.nonWitnessUtxo);
  } catch {
    return null;
  }
  // A nonWitnessUtxo that is not the spent transaction says nothing about it.
  if (!Buffer.from(previous.getHash()).equals(Buffer.from(txInput.hash))) {
    return null;
  }
  return previous.outs[txInput.index]?.script ?? null;
}

/**
 * The commit a reveal binds to, read off the commit PSBT the wallet signs: the
 * unsigned transaction, and the reveal's source — the output its input 0 spends.
 *
 * The composer builds the reveal against the *unsigned* commit's txid, which is
 * the txid broadcast only when signing adds nothing but witnesses. An input
 * spending a legacy or P2SH-wrapped output signs into its scriptSig, which the
 * txid covers, and the reveal would then spend a transaction that never
 * exists. So every input must carry its prevout and spend a native witness
 * program.
 *
 * @throws {RevealVerificationError}
 */
export function readRevealCommit(commitPsbtHex: string): RevealCommit {
  let psbt: btc.Psbt;
  try {
    psbt = psbtFromHex(commitPsbtHex);
  } catch {
    throw new RevealVerificationError("the commit is not a valid PSBT");
  }
  const scripts = psbt.txInputs.map((txInput, index) => {
    const script = prevoutScript(psbt.data.inputs[index], txInput);
    if (!script) {
      throw new RevealVerificationError(
        `input ${index} of the commit carries no prevout (witnessUtxo or ` +
          "nonWitnessUtxo), so what it spends cannot be checked",
      );
    }
    if (!isWitnessProgram(script)) {
      throw new RevealVerificationError(
        `input ${index} of the commit does not spend a native segwit output: ` +
          "signing it would change the commit's txid, and the reveal spends " +
          "the unsigned one",
      );
    }
    return script;
  });
  if (scripts.length === 0) {
    throw new RevealVerificationError("the commit has no inputs");
  }
  return {
    commitTxHex: unsignedTxHexOf(psbt),
    sourceScriptPubkey: Buffer.from(scripts[0]).toString("hex"),
  };
}

/**
 * The reveal as a PSBT any {@link Signer} can sign: one taproot input carrying
 * the envelope as a `tapLeafScript` (BIP371), so a signer whose key closes the
 * leaf produces a script-path signature and finalizing yields the witness
 * `<signature> <envelope_script> <control_block>`.
 *
 * `tapInternalKey` / `tapMerkleRoot` are filled in too: they let a wallet
 * re-derive the output script itself, and they steer bitcoinjs away from a
 * key-path signature (the output key is the tweak of the *internal* key by the
 * leaf hash, which no wallet key matches).
 *
 * `tapMerkleRoot = leaf hash` holds for a single-leaf tree only — which is the
 * only tree {@link verifyReveal} lets through (it rebuilds the commit output
 * from the envelope alone and requires the control block to match, i.e. an
 * empty merkle path), and the only one the composer builds. A wallet is free
 * to ignore the field and recompute the commitment from the control block.
 */
export function buildRevealPsbt(
  verified: VerifiedReveal,
  network: btc.Network,
): btc.Psbt {
  const { reveal } = verified;
  const psbt = new btc.Psbt({ network });
  psbt.setVersion(reveal.version);
  psbt.setLocktime(reveal.locktime);
  const input = reveal.ins[0];
  psbt.addInput({
    hash: Buffer.from(input.hash),
    index: input.index,
    sequence: input.sequence,
    witnessUtxo: { script: verified.lockScript, value: verified.inputValue },
    tapInternalKey: verified.pubkey,
    tapMerkleRoot: verified.leafHash,
    tapLeafScript: [
      {
        leafVersion: TAPSCRIPT_LEAF_VERSION,
        script: verified.envelope,
        controlBlock: verified.controlBlock,
      },
    ],
  });
  for (const out of reveal.outs) {
    psbt.addOutput({ script: Buffer.from(out.script), value: out.value });
  }
  return psbt;
}

/**
 * Check a signed reveal is the one we verified, with the exact witness the node
 * requires: three elements, `<schnorr sig> <envelope> <control block>`, the
 * signature 64 bytes (`SIGHASH_DEFAULT`) or 65 ending in `0x01` (`SIGHASH_ALL`)
 * and valid for the envelope key over the script-path sighash. A wallet that
 * signed the wrong hash, the wrong key, or a different sighash type would
 * otherwise go on-chain unnoticed.
 *
 * @throws {RevealVerificationError}
 */
export function assertSignedReveal(
  signedRevealTxHex: string,
  verified: VerifiedReveal,
): SignedReveal {
  ensureEccLib();
  let signed: btc.Transaction;
  try {
    signed = btc.Transaction.fromHex(signedRevealTxHex);
  } catch {
    throw new RevealVerificationError("the signed reveal is not valid hex");
  }
  if (signed.getId() !== verified.revealTxid) {
    throw new RevealVerificationError(
      "signing changed the reveal's txid — its inputs or outputs were altered",
    );
  }
  const witness = signed.ins[0]?.witness ?? [];
  if (witness.length !== 3) {
    throw new RevealVerificationError(
      `the reveal witness has ${witness.length} elements; expected <sig> <envelope> <control block>`,
    );
  }
  const [signature, envelope, controlBlock] = witness.map((w) => Buffer.from(w));
  if (!envelope.equals(verified.envelope)) {
    throw new RevealVerificationError("the reveal witness carries a different envelope");
  }
  if (!controlBlock.equals(verified.controlBlock)) {
    throw new RevealVerificationError("the reveal witness carries a different control block");
  }
  let hashType: number;
  if (signature.length === 64) {
    hashType = btc.Transaction.SIGHASH_DEFAULT;
  } else if (
    signature.length === 65 &&
    signature[64] === btc.Transaction.SIGHASH_ALL
  ) {
    hashType = btc.Transaction.SIGHASH_ALL;
  } else {
    throw new RevealVerificationError(
      "the reveal signature must be 64 bytes (SIGHASH_DEFAULT) or 65 bytes ending in 0x01 (SIGHASH_ALL)",
    );
  }
  const sighash = verified.reveal.hashForWitnessV1(
    0,
    [verified.lockScript],
    [verified.inputValue],
    hashType,
    verified.leafHash,
  );
  if (!ecc.verifySchnorr(sighash, verified.pubkey, signature.subarray(0, 64))) {
    throw new RevealVerificationError(
      "the reveal signature does not verify for the envelope key",
    );
  }
  return { revealTxHex: signed.toHex(), revealTxid: verified.revealTxid };
}

/**
 * The x-only keys a signer can close a leaf with, for
 * {@link VerifyRevealOptions.expectedKeys}: its segwit key, its taproot internal
 * key, and that key's BIP86 output key (the composer's fallback for a P2TR
 * source). Exactly the keys `signPsbtHexWithKeys` signs a `tapLeafScript` with,
 * so a reveal that passes the check is one the SDK signers can sign. Anything
 * that is not a public key (a wallet that shared none) is left out.
 */
export function signerKeys(
  addresses: Pick<ReturnType<Signer["getAddresses"]>, "publicKey" | "xOnlyPubkey">,
): string[] {
  const keys = new Set<string>();
  const xOnlyOf = (keyHex: string | undefined): Buffer | null => {
    if (!keyHex || !PUBKEY_HEX.test(keyHex)) return null;
    const xOnly = Buffer.from(toXOnlyHex(keyHex), "hex");
    return ecc.isXOnlyPoint(xOnly) ? xOnly : null;
  };
  const segwit = xOnlyOf(addresses.publicKey);
  if (segwit) keys.add(segwit.toString("hex"));
  const taproot = xOnlyOf(addresses.xOnlyPubkey);
  if (taproot) {
    keys.add(taproot.toString("hex"));
    const outputKey = bip86OutputKey(taproot);
    if (outputKey) keys.add(outputKey.toString("hex"));
  }
  return [...keys];
}

/**
 * Check the wallet signed the commit it was shown and nothing else. A reveal
 * spends the quoted commit's txid, which only the transaction a PSBT wraps —
 * inputs, outputs, version, locktime — determines: a wallet that changed any of
 * it would have the commit broadcast under a txid the reveal does not spend,
 * stranding the commit output.
 *
 * @throws {RevealVerificationError}
 */
export function assertCommitUnchanged(
  quotedPsbtHex: string,
  signedPsbtHex: string,
): void {
  let signed: string;
  try {
    signed = unsignedTxHexFromPsbt(signedPsbtHex);
  } catch {
    throw new RevealVerificationError(
      "the wallet returned something other than a PSBT for the commit",
    );
  }
  if (signed !== unsignedTxHexFromPsbt(quotedPsbtHex)) {
    throw new RevealVerificationError(
      "the wallet changed the commit while signing it, so its txid is no " +
        "longer the one the reveal spends",
    );
  }
}

/**
 * Sign and finalize a reveal {@link verifyReveal} already checked: build the
 * script-path PSBT, hand it to `signer.signPsbtHex`, finalize, and check the
 * resulting witness before returning it. The signer never sees a raw hash: an
 * in-process key signs the leaf directly, an external wallet is shown a
 * one-input PSBT it can inspect — and may hand back finalized.
 *
 * Broadcast the returned hex **after** the commit.
 *
 * @throws {RevealVerificationError} when the signer produced something other
 * than a valid envelope signature.
 */
export async function signVerifiedReveal(
  verified: VerifiedReveal,
  signer: Pick<Signer, "signPsbtHex">,
  network: btc.Network,
): Promise<SignedReveal> {
  const psbt = buildRevealPsbt(verified, network);
  const signedPsbtHex = await signer.signPsbtHex(psbt.toHex(), [0]);
  let txHex: string;
  try {
    ({ txHex } = finalizePsbtHex(signedPsbtHex, network));
  } catch (cause) {
    throw new RevealVerificationError(
      `the wallet did not return a signed reveal (${String(cause)})`,
    );
  }
  return assertSignedReveal(txHex, verified);
}

export interface SignRevealParams extends RevealCommit {
  /** The unsigned reveal (`reveal_rawtransaction`). */
  revealTxHex: string;
  material: RevealSigningMaterial;
  signer: Signer;
  network: btc.Network;
}

/**
 * Verify, sign and finalize a reveal with any {@link Signer}:
 * {@link verifyReveal} against the commit, its source and the signer's keys,
 * then {@link signVerifiedReveal}. Take the commit and its source from the
 * commit PSBT with {@link readRevealCommit}.
 *
 * Broadcast the returned hex **after** the commit.
 *
 * @throws {RevealVerificationError} when the material does not check out, or
 * the signer produced something other than a valid envelope signature.
 */
export async function signReveal(params: SignRevealParams): Promise<SignedReveal> {
  const verified = verifyReveal(params.revealTxHex, params.material, {
    commitTxHex: params.commitTxHex,
    sourceScriptPubkey: params.sourceScriptPubkey,
    expectedKeys: signerKeys(params.signer.getAddresses()),
  });
  return signVerifiedReveal(verified, params.signer, params.network);
}

/**
 * The reveal a quote asks the wallet to sign, or `null` when it asks for none:
 * the rule every quote that can carry one shares. A reveal without its signing
 * material was pre-signed server-side with a throwaway key, which the network
 * has ignored since Counterparty Core v11.5.0; material without a reveal
 * leaves nothing to sign it on.
 *
 * @param context names the quote in the error, e.g. `"The sell quote"`.
 * @throws {PresignedRevealError} for a reveal without its material.
 */
export function revealToSign(
  context: string,
  revealTxHex: string | null | undefined,
  material: RevealSigningMaterial | null | undefined,
): { revealTxHex: string; material: RevealSigningMaterial } | null {
  if (revealTxHex && !material) throw new PresignedRevealError(context);
  if (material && !revealTxHex) {
    throw new Error(
      `${context} carries reveal signing material but no reveal transaction.`,
    );
  }
  return revealTxHex && material ? { revealTxHex, material } : null;
}

/**
 * Bare multisig, `OP_m <keys> OP_n OP_CHECKMULTISIG` with `1 ≤ m ≤ n ≤ 16`
 * and 33- or 65-byte keys — the shape Counterparty's multisig encoding gives
 * its data outputs. The whole script is matched, not its last byte: a hash or
 * key ending in `0xae` must not pass for one.
 */
function isBareMultisig(script: Uint8Array): boolean {
  let chunks: Array<number | Uint8Array> | null;
  try {
    chunks = btc.script.decompile(script);
  } catch {
    return false;
  }
  if (!chunks || chunks.length < 4) return false;
  const m = chunks[0];
  const n = chunks[chunks.length - 2];
  if (chunks[chunks.length - 1] !== OPS.OP_CHECKMULTISIG) return false;
  if (typeof m !== "number" || typeof n !== "number") return false;
  if (m < OPS.OP_1 || m > OPS.OP_16 || n < m || n > OPS.OP_16) return false;
  const keys = chunks.slice(1, -2);
  return (
    keys.length === n - OPS.OP_1 + 1 &&
    keys.every(
      (key) => typeof key !== "number" && (key.length === 33 || key.length === 65),
    )
  );
}

/**
 * Whether a composed Counterparty transaction carries its message inline — an
 * `OP_RETURN` or a bare-multisig data output — rather than in a reveal. A
 * commit has neither: its message sits in the envelope leaf, so a quote that
 * returns a commit *without* a reveal to sign would strand the commit output.
 */
export function carriesInlineCounterpartyData(txOrPsbtHex: string): boolean {
  let outs: Array<{ script: Uint8Array }>;
  if (txOrPsbtHex.startsWith("70736274ff")) {
    outs = psbtFromHex(txOrPsbtHex).txOutputs;
  } else {
    outs = btc.Transaction.fromHex(txOrPsbtHex).outs;
  }
  return outs.some(
    (out) => out.script[0] === OPS.OP_RETURN || isBareMultisig(out.script),
  );
}

/**
 * `Psbt.fromHex`, minus its leniency: `Buffer.from(hex, "hex")` stops at the
 * first non-hex character, so `"<psbt>garbage"` would parse as the PSBT.
 */
function psbtFromHex(psbtHex: string): btc.Psbt {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(psbtHex)) {
    throw new Error("Not a hex-encoded PSBT");
  }
  return btc.Psbt.fromHex(psbtHex);
}

function unsignedTxHexOf(psbt: btc.Psbt): string {
  return Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString("hex");
}

/** The unsigned transaction a PSBT wraps, as hex — what a reveal binds to. */
export function unsignedTxHexFromPsbt(psbtHex: string): string {
  return unsignedTxHexOf(psbtFromHex(psbtHex));
}
