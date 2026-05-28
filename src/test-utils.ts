import * as btc from "bitcoinjs-lib";
import { vi } from "vitest";
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
): typeof globalThis.fetch {
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
