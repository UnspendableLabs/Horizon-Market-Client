import * as btc from "bitcoinjs-lib";
import { vi, type MockedFunction } from "vitest";
import type { Signer } from "./crypto/signer.js";
import { ECPair } from "./crypto/ecc.js";

// ─── Minimal P2WPKH PSBT fixture ─────────────────────────────────────────────
// One input (100 000 sats, P2WPKH) → one output (99 000 sats, same script).
// The UTXO script belongs to TEST_PRIVATE_KEY_HEX below.
export const TEST_PRIVATE_KEY_HEX =
  "0567c83f95376b2f9d6cfd221efb3984562a38b0927336b933bb4f46ded66a3b";

export const TEST_P2WPKH_ADDRESS = "bc1q426kredpywalunxxg46fxlnye3rst035nhpukx";

function deriveP2trAddress(
  privateKeyHex: string,
  network: btc.Network = btc.networks.bitcoin,
): string {
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, "hex"), {
    network,
  });
  const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);
  const { address } = btc.payments.p2tr({ internalPubkey: xOnlyPubkey, network });
  if (!address) throw new Error("Failed to derive P2TR address for test fixture");
  return address;
}

export const TEST_P2TR_ADDRESS = deriveP2trAddress(TEST_PRIVATE_KEY_HEX);

export const FIXTURE_PSBT_HEX =
  "70736274ff010052020000000100000000000000000000000000000000000000000000000000000000000000a00000000000ffffffff01b882010000000000160014aab561e5a123bbfe4cc64574937e64cc4705be34000000000001011fa086010000000000160014aab561e5a123bbfe4cc64574937e64cc4705be340000";

/** Minimal P2TR key-path PSBT spendable with TEST_PRIVATE_KEY_HEX. */
export function buildTaprootPsbtFixture(
  privateKeyHex: string = TEST_PRIVATE_KEY_HEX,
  network: btc.Network = btc.networks.bitcoin,
): string {
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, "hex"), {
    network,
  });
  const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);
  const p2tr = btc.payments.p2tr({ internalPubkey: xOnlyPubkey, network });
  if (!p2tr.output) {
    throw new Error("Failed to derive P2TR output script for fixture PSBT");
  }

  const psbt = new btc.Psbt({ network });
  psbt.addInput({
    hash: "a".repeat(64),
    index: 0,
    witnessUtxo: { script: p2tr.output, value: BigInt(100_000) },
    tapInternalKey: xOnlyPubkey,
  });
  psbt.addOutput({ script: p2tr.output, value: BigInt(99_000) });
  return psbt.toHex();
}

/**
 * Minimal P2TR key-path PSBT that carries ONLY the `witnessUtxo` and omits
 * `tapInternalKey`, reproducing server-composed fee PSBT inputs (the
 * "Fee PSBT signing failed" regression).
 */
export function buildTaprootPsbtFixtureNoInternalKey(
  privateKeyHex: string = TEST_PRIVATE_KEY_HEX,
  network: btc.Network = btc.networks.bitcoin,
): string {
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKeyHex, "hex"), {
    network,
  });
  const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);
  const p2tr = btc.payments.p2tr({ internalPubkey: xOnlyPubkey, network });
  if (!p2tr.output) {
    throw new Error("Failed to derive P2TR output script for fixture PSBT");
  }

  const psbt = new btc.Psbt({ network });
  psbt.addInput({
    hash: "a".repeat(64),
    index: 0,
    witnessUtxo: { script: p2tr.output, value: BigInt(100_000) },
    // Intentionally NO tapInternalKey — bitcoinjs still routes this through its
    // Taproot signer because the witnessUtxo script is P2TR.
  });
  psbt.addOutput({ script: p2tr.output, value: BigInt(99_000) });
  return psbt.toHex();
}

// ─── Mock fetch helpers ───────────────────────────────────────────────────────

export function makeFetch(
  status: number,
  body: unknown,
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    statusText: "OK",
  } as Response);
}

export function makeSequentialFetch(
  ...responses: Array<{ status: number; body: unknown }>
): MockedFunction<typeof globalThis.fetch> {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const { status, body } =
      responses[call++] ?? responses[responses.length - 1];
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
      statusText: "OK",
    } as Response);
  });
}

/** Build a mock Response with a real Headers instance (supports Set-Cookie). */
export function mockResponse(
  status: number,
  body: unknown,
  setCookies: string[] = [],
): Response {
  const headers = new Headers();
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "OK",
    headers,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Mock fetch returning successive {@link mockResponse} values (cookie-aware). */
export function makeFetchResponses(
  ...responses: Response[]
): MockedFunction<typeof globalThis.fetch> {
  let call = 0;
  return vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(responses[call++] ?? responses[responses.length - 1]),
    );
}

// ─── Mock signer ──────────────────────────────────────────────────────────────

export function makeSigner(
  addresses?: Partial<ReturnType<Signer["getAddresses"]>>,
): Signer {
  return {
    getAddresses: vi.fn().mockReturnValue({
      p2wpkh: "bc1qseller",
      publicKey: "02aabbcc",
      ...addresses,
    }),
    signPsbtHex: vi.fn().mockImplementation((hex: string) => `${hex}_signed`),
    signMessage: vi.fn().mockReturnValue("base64sig=="),
  };
}

/**
 * Like {@link makeSigner}, but `signPsbtHex` / `signMessage` resolve
 * ASYNCHRONOUSLY (they return a `Promise<string>`), modelling an external wallet
 * (browser extension / mobile) that signs through a popup and never exposes its
 * key. Resolves to the exact same values as {@link makeSigner}, so a test can
 * assert the identical signed output — the point is that every signer call site
 * must `await` the result. A dropped `await` would surface the unresolved
 * Promise (serialized as `{}`) in place of the signature, failing the assertion.
 */
export function makeAsyncSigner(
  addresses?: Partial<ReturnType<Signer["getAddresses"]>>,
): Signer {
  return {
    getAddresses: vi.fn().mockReturnValue({
      p2wpkh: "bc1qseller",
      publicKey: "02aabbcc",
      ...addresses,
    }),
    signPsbtHex: vi
      .fn()
      .mockImplementation(async (hex: string) => `${hex}_signed`),
    signMessage: vi.fn().mockImplementation(async () => "base64sig=="),
  };
}

// ─── Counterparty taproot commit/reveal fixtures ─────────────────────────────

/**
 * A commit/reveal pair produced by the **node's own** construction (bitcoinutils
 * 0.7.1, the same code path as `counterpartycore.lib.api.composer`) for
 * `TEST_PRIVATE_KEY_HEX` as a P2WPKH source, and signed by the reference
 * wallet-side routine (`sign_reveal_transaction` in the node's regtest suite).
 * Generated by `gen_fixture.py`; `sighash` is bitcoinutils' script-path digest,
 * `pythonSignature` its Schnorr signature over it.
 */
export const REVEAL_FIXTURE = {
  privateKeyHex: TEST_PRIVATE_KEY_HEX,
  xOnlyPubkey: "0fa5807b4e6ad4b555ddd3037fe0bf12d9d01f48927a2462f374c77669c7a6a6",
  sourceAddress: TEST_P2WPKH_ADDRESS,
  commitTxHex:
    "0200000001aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0100000000ffffffff02881300000000000022512048942abe3aeb54e63de2088d6694179ea4e5c3a9b6b66445cb1eccd5eb7be7c9905f010000000000160014aab561e5a123bbfe4cc64574937e64cc4705be3400000000",
  commitTxid: "29eb9a60f2d56168545bafd629be4e2846cf5e9c46cab99447401c637a5c54a2",
  revealTxHex:
    "0200000001a2545c7a631c404794b9ca469c5ecf46284ebe29d6af5b546861d5f2609aeb290000000000ffffffff0100000000000000000a6a08434e54525052545900000000",
  revealTxid: "43ae355f812be9ff14b0ba463bc081dff798ce48c2c16a0bdec2962eba0a04df",
  signedRevealTxHex:
    "02000000000101a2545c7a631c404794b9ca469c5ecf46284ebe29d6af5b546861d5f2609aeb290000000000ffffffff0100000000000000000a6a08434e5452505254590340c1fa05d7d2e5a91bc3ba2829a60462b5e36694a64f2151c7289f8460f5b72864a7ed689b659222b47484e4921087ce5bde73cc30e9a2cdd5ffba75b1e8d02611a900634c82000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808168200fa5807b4e6ad4b555ddd3037fe0bf12d9d01f48927a2462f374c77669c7a6a6ac21c10fa5807b4e6ad4b555ddd3037fe0bf12d9d01f48927a2462f374c77669c7a6a600000000",
  envelopeScript:
    "00634c82000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808168200fa5807b4e6ad4b555ddd3037fe0bf12d9d01f48927a2462f374c77669c7a6a6ac",
  controlBlock: "c10fa5807b4e6ad4b555ddd3037fe0bf12d9d01f48927a2462f374c77669c7a6a6",
  lockScript: "512048942abe3aeb54e63de2088d6694179ea4e5c3a9b6b66445cb1eccd5eb7be7c9",
  inputValue: 5000,
  sighash: "3ed7598fa31bec7e0fb7f885e863a801d7b3afc2f0e427ab3f44de14feac9254",
  pythonSignature:
    "c1fa05d7d2e5a91bc3ba2829a60462b5e36694a64f2151c7289f8460f5b72864a7ed689b659222b47484e4921087ce5bde73cc30e9a2cdd5ffba75b1e8d02611",
} as const;

/** The composer's result fields for {@link REVEAL_FIXTURE}, wire-shaped. */
export const REVEAL_FIXTURE_WIRE = {
  reveal_tx_hex: REVEAL_FIXTURE.revealTxHex,
  envelope_script: REVEAL_FIXTURE.envelopeScript,
  reveal_control_block: REVEAL_FIXTURE.controlBlock,
  reveal_pubkey: REVEAL_FIXTURE.xOnlyPubkey,
  reveal_lock_scripts: [REVEAL_FIXTURE.lockScript],
  reveal_inputs_values: [REVEAL_FIXTURE.inputValue],
} as const;

/**
 * The commit of {@link REVEAL_FIXTURE} as the PSBT a creation quote returns
 * (unsigned, one P2WPKH input hydrated with its witnessUtxo).
 */
export function revealFixtureCommitPsbtHex(
  network: btc.Network = btc.networks.bitcoin,
): string {
  const commit = btc.Transaction.fromHex(REVEAL_FIXTURE.commitTxHex);
  const psbt = new btc.Psbt({ network });
  psbt.setVersion(commit.version);
  psbt.setLocktime(commit.locktime);
  const source = btc.address.toOutputScript(TEST_P2WPKH_ADDRESS, network);
  for (const input of commit.ins) {
    psbt.addInput({
      hash: Buffer.from(input.hash),
      index: input.index,
      sequence: input.sequence,
      witnessUtxo: { script: source, value: 100_000n },
    });
  }
  for (const out of commit.outs) {
    psbt.addOutput({ script: Buffer.from(out.script), value: out.value });
  }
  return psbt.toHex();
}

/**
 * Build a commit/reveal pair in TypeScript for an arbitrary envelope key, the
 * way the composer does: single-leaf tree, internal key = the envelope key,
 * reveal = one input (`commit:0`) → `OP_RETURN CNTRPRTY`.
 */
export function buildRevealPair(
  envelopeKeyXOnlyHex: string,
  opts: { data?: Buffer; commitValue?: number; network?: btc.Network } = {},
): {
  commitTxHex: string;
  revealTxHex: string;
  material: {
    envelopeScript: string;
    controlBlock: string;
    pubkey: string;
    lockScript: string;
    inputValue: number;
  };
} {
  const network = opts.network ?? btc.networks.bitcoin;
  const data = opts.data ?? Buffer.from(Array.from({ length: 130 }, (_, i) => i));
  const commitValue = opts.commitValue ?? 5000;
  const pubkey = Buffer.from(envelopeKeyXOnlyHex, "hex");
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += 520) chunks.push(data.subarray(i, i + 520));
  const envelope = Buffer.from(
    btc.script.compile([
      btc.opcodes.OP_0,
      btc.opcodes.OP_IF,
      ...chunks,
      btc.opcodes.OP_ENDIF,
      pubkey,
      btc.opcodes.OP_CHECKSIG,
    ]),
  );
  const tree = btc.payments.p2tr({
    internalPubkey: pubkey,
    scriptTree: { output: envelope },
    redeem: { output: envelope, redeemVersion: 0xc0 },
    network,
  });
  const lockScript = Buffer.from(tree.output!);
  const controlBlock = Buffer.from(tree.witness![tree.witness!.length - 1]);

  const commit = new btc.Transaction();
  commit.version = 2;
  commit.addInput(Buffer.alloc(32, 0xaa), 1);
  commit.addOutput(lockScript, BigInt(commitValue));
  commit.addOutput(btc.address.toOutputScript(TEST_P2WPKH_ADDRESS, network), 90_000n);

  const reveal = new btc.Transaction();
  reveal.version = 2;
  reveal.addInput(Buffer.from(commit.getHash()), 0);
  reveal.addOutput(
    btc.script.compile([btc.opcodes.OP_RETURN, Buffer.from("CNTRPRTY", "ascii")]),
    0n,
  );

  return {
    commitTxHex: commit.toHex(),
    revealTxHex: reveal.toHex(),
    material: {
      envelopeScript: envelope.toString("hex"),
      controlBlock: controlBlock.toString("hex"),
      pubkey: envelopeKeyXOnlyHex,
      lockScript: lockScript.toString("hex"),
      inputValue: commitValue,
    },
  };
}

/**
 * A Counterparty issuance as the creations API quotes it when the message fits
 * an `OP_RETURN`: one P2WPKH input of `TEST_PRIVATE_KEY_HEX`, an `OP_RETURN`
 * data output and the change. The inline data output is what tells the create
 * workflow there is no reveal to expect.
 */
export function buildIssuancePsbtHex(
  network: btc.Network = btc.networks.bitcoin,
): string {
  const source = btc.address.toOutputScript(TEST_P2WPKH_ADDRESS, network);
  const psbt = new btc.Psbt({ network });
  psbt.addInput({
    hash: "a".repeat(64),
    index: 0,
    witnessUtxo: { script: source, value: 100_000n },
  });
  psbt.addOutput({
    script: Buffer.from(
      btc.script.compile([btc.opcodes.OP_RETURN, Buffer.alloc(40, 0x42)]),
    ),
    value: 0n,
  });
  psbt.addOutput({ script: source, value: 99_000n });
  return psbt.toHex();
}

export const FIXTURE_ISSUANCE_PSBT_HEX = buildIssuancePsbtHex();
