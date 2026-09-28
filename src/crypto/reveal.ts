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
 * envelope is not canonical, is closed by a key that is not ours, does not
 * hash to the commit output, or the reveal does not spend `commit:0`. Signing
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
  /** BIP341 tapleaf hash of the envelope under leaf version `0xc0`. */
  leafHash: Buffer;
}

export interface VerifyRevealOptions {
  /**
   * The commit transaction (unsigned or signed — the reveal binds to its txid,
   * which segwit signing cannot move). Its output 0 must be the envelope output
   * the material describes.
   */
  commitTxHex: string;
  /**
   * Keys the wallet can sign for, as hex: compressed (66 chars) or x-only
   * (64 chars). The envelope must be closed by one of them, or by the BIP86
   * output key of one of them (the composer's fallback for a P2TR source whose
   * key it could not find). When omitted the key check is skipped.
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

/** BIP341 `TapLeaf` tagged hash: `leaf_version || compact_size(script) || script`. */
export function tapleafHash(script: Uint8Array): Buffer {
  const len = script.length;
  let size: Buffer;
  if (len < 0xfd) size = Buffer.from([len]);
  else if (len <= 0xffff) {
    size = Buffer.alloc(3);
    size[0] = 0xfd;
    size.writeUInt16LE(len, 1);
  } else {
    size = Buffer.alloc(5);
    size[0] = 0xfe;
    size.writeUInt32LE(len, 1);
  }
  return Buffer.from(
    btc.crypto.taggedHash(
      "TapLeaf",
      Buffer.concat([Buffer.from([TAPSCRIPT_LEAF_VERSION]), size, script]),
    ),
  );
}

/** x-only form of a hex key: compressed keys lose their parity byte. */
export function toXOnlyHex(keyHex: string): string {
  const key = keyHex.toLowerCase();
  return key.length === 66 ? key.slice(2) : key;
}

/**
 * BIP86 output key of an x-only internal key (tweak with an empty merkle root)
 * — the key a P2TR address's scriptPubKey carries. `null` off the curve.
 */
export function taprootOutputKeyHex(xOnlyHex: string): string | null {
  ensureEccLib();
  const xOnly = Buffer.from(xOnlyHex, "hex");
  if (xOnly.length !== 32) return null;
  let tweaked: { xOnlyPubkey: Uint8Array } | null;
  try {
    tweaked = ecc.xOnlyPointAddTweak(
      xOnly,
      btc.crypto.taggedHash("TapTweak", xOnly),
    );
  } catch {
    return null;
  }
  return tweaked ? Buffer.from(tweaked.xOnlyPubkey).toString("hex") : null;
}

const { OPS } = btc.script;

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
 * the reveal, plus the two that protect the wallet itself: the envelope is
 * closed by *our* key, and the commit output really is the envelope output.
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

  // 2. …and that key is one of ours.
  if (options.expectedKeys) {
    const ours = new Set<string>();
    for (const key of options.expectedKeys) {
      const xOnly = toXOnlyHex(key);
      ours.add(xOnly);
      const outputKey = taprootOutputKeyHex(xOnly);
      if (outputKey) ours.add(outputKey);
    }
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
    leafHash: tapleafHash(envelope),
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

/** The keys a signer can sign for, for {@link VerifyRevealOptions.expectedKeys}. */
export function signerKeys(signer: Pick<Signer, "getAddresses">): string[] {
  const { publicKey, xOnlyPubkey } = signer.getAddresses();
  const keys = [publicKey];
  if (xOnlyPubkey) keys.push(xOnlyPubkey);
  return keys;
}

export interface SignRevealParams {
  /** The unsigned reveal (`reveal_rawtransaction`). */
  revealTxHex: string;
  material: RevealSigningMaterial;
  /** The commit the reveal spends — see {@link VerifyRevealOptions.commitTxHex}. */
  commitTxHex: string;
  signer: Signer;
  network: btc.Network;
}

/**
 * Verify, sign and finalize a reveal with any {@link Signer}: build the
 * script-path PSBT, hand it to `signer.signPsbtHex`, finalize, and check the
 * resulting witness before returning it. The signer never sees a raw hash:
 * an in-process key signs the leaf directly, an external wallet is shown a
 * one-input PSBT it can inspect.
 *
 * Broadcast the returned hex **after** the commit.
 *
 * @throws {RevealVerificationError} when the material does not check out, or
 * the signer produced something other than a valid envelope signature.
 */
export async function signReveal(params: SignRevealParams): Promise<SignedReveal> {
  const verified = verifyReveal(params.revealTxHex, params.material, {
    commitTxHex: params.commitTxHex,
    expectedKeys: signerKeys(params.signer),
  });
  const psbt = buildRevealPsbt(verified, params.network);
  const signedPsbtHex = await params.signer.signPsbtHex(psbt.toHex(), [0]);
  const { txHex } = finalizePsbtHex(signedPsbtHex, params.network);
  return assertSignedReveal(txHex, verified);
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
    outs = btc.Psbt.fromHex(txOrPsbtHex).txOutputs;
  } else {
    outs = btc.Transaction.fromHex(txOrPsbtHex).outs;
  }
  return outs.some((out) => {
    const script = out.script;
    if (script.length === 0) return false;
    if (script[0] === OPS.OP_RETURN) return true;
    return script[script.length - 1] === OPS.OP_CHECKMULTISIG;
  });
}

/** The unsigned transaction a PSBT wraps, as hex — what a reveal binds to. */
export function unsignedTxHexFromPsbt(psbtHex: string): string {
  const psbt = btc.Psbt.fromHex(psbtHex);
  return Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString("hex");
}
