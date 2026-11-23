import { describe, expect, it, vi } from "vitest";
import { hex } from "@scure/base";
import { p2tr, Script, SigHash, Transaction } from "@scure/btc-signer";
import { Identity, signet } from "@kontor/sdk";
import {
  LocalSigner,
  type Signer,
  type SignPsbtHexOptions,
} from "../crypto/signer.js";
import { createWalletKontorSigning } from "./wallet-signing.js";

/**
 * The external-wallet Kontor `Signing` adapter. Builds the identity from the
 * wallet's x-only key and delegates PSBT / message signing to the generic
 * {@link Signer}, without ever holding a private key.
 */

const X_ONLY = "ab".repeat(32);
// The canonical P2TR the wallet must report for X_ONLY (Kontor re-tweaks the
// internal key exactly like a standard key-path taproot wallet — verified so the
// address-match guard is exercised against a real derivation, not a stub).
const P2TR = Identity.fromXOnly(X_ONLY, signet).address;
// A real, valid taproot address for a DIFFERENT key — used to trip the guard.
const OTHER_P2TR = new LocalSigner("01".repeat(32), "testnet").getAddresses()
  .p2tr!;

/** A P2TR PSBT (single taproot input, one output) for the psbt() paths. */
function taprootPsbt(): Uint8Array {
  const internalKey = hex.decode(X_ONLY);
  const script = p2tr(internalKey).script;
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid: hex.decode("11".repeat(32)),
    index: 0,
    witnessUtxo: { script, amount: 1000n },
    tapInternalKey: internalKey,
  });
  tx.addOutput({ script, amount: 900n });
  return tx.toPSBT();
}

/**
 * A revoke-shaped PSBT owned by `xOnly`: input 0 spends a `<key> OP_CHECKSIG`
 * TapScript leaf (script path), input 1 is a plain key-path P2TR spend.
 */
function twoInputPsbt(xOnly: string): Uint8Array {
  const key = hex.decode(xOnly);
  const leaf = Script.encode([key, "CHECKSIG"]);
  const leafSpend = p2tr(key, { script: leaf }, undefined, true);
  const keySpend = p2tr(key);
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid: hex.decode("22".repeat(32)),
    index: 0,
    witnessUtxo: { script: leafSpend.script, amount: 1000n },
    tapInternalKey: key,
    tapLeafScript: leafSpend.tapLeafScript,
  });
  tx.addInput({
    txid: hex.decode("33".repeat(32)),
    index: 1,
    witnessUtxo: { script: keySpend.script, amount: 2000n },
    tapInternalKey: key,
  });
  tx.addOutput({ script: keySpend.script, amount: 2500n });
  return tx.toPSBT();
}

/** A Signer stub that records what the adapter asks it to sign. */
function stubSigner(over: Partial<Signer> = {}): Signer {
  return {
    getAddresses: () => ({
      p2wpkh: "tb1qseg",
      p2tr: P2TR,
      publicKey: "02" + "11".repeat(32),
      xOnlyPubkey: X_ONLY,
    }),
    // Echo the received PSBT back as the "signed" result.
    signPsbtHex: vi.fn((psbtHex: string) => psbtHex),
    signMessage: vi.fn(() => "sig-base64"),
    ...over,
  };
}

describe("createWalletKontorSigning", () => {
  it("derives the Kontor identity from the wallet's x-only key", () => {
    const signing = createWalletKontorSigning(stubSigner(), signet);
    expect(signing.identity.xOnlyPubKey).toBe(X_ONLY);
    expect(signing.identity.address).toBe(P2TR);
    // Wallet signers can't produce raw Schnorr, so no BLS-registration capability.
    expect(signing.schnorr).toBeUndefined();
  });

  it("normalizes a 33-byte compressed taproot key to x-only", () => {
    const signer = stubSigner({
      getAddresses: () => ({
        p2wpkh: "tb1qseg",
        p2tr: P2TR,
        publicKey: "00",
        xOnlyPubkey: "03" + X_ONLY, // compressed, odd-parity prefix
      }),
    });
    const signing = createWalletKontorSigning(signer, signet);
    expect(signing.identity.xOnlyPubKey).toBe(X_ONLY);
  });

  it("passes the PSBT straight through under the default sighash", async () => {
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);
    const psbt = taprootPsbt();

    const out = await signing.psbt(psbt, { inputs: [{ index: 0 }] });

    // No sighash rewrite → the wallet sees the exact bytes, and we round-trip
    // them. The default is still stated explicitly for list-taking wallet APIs.
    expect(signer.signPsbtHex).toHaveBeenCalledWith(hex.encode(psbt), [0], {
      sighashTypes: { 0: SigHash.DEFAULT },
    });
    expect(hex.encode(out)).toBe(hex.encode(psbt));
  });

  it("awaits an asynchronous wallet signPsbtHex before decoding", async () => {
    // A real external wallet resolves its signature asynchronously (popup). The
    // adapter must await it — otherwise it would hex-decode a pending Promise.
    const signer = stubSigner({
      signPsbtHex: vi.fn(async (psbtHex: string) => psbtHex),
    });
    const signing = createWalletKontorSigning(signer, signet);
    const psbt = taprootPsbt();

    const out = await signing.psbt(psbt, { inputs: [{ index: 0 }] });

    expect(hex.encode(out)).toBe(hex.encode(psbt));
  });

  it("stamps the requested sighash onto each input before signing", async () => {
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);
    const psbt = taprootPsbt();

    await signing.psbt(psbt, {
      inputs: [{ index: 0, sighash: "single-anyonecanpay" }],
    });

    const sentHex = (signer.signPsbtHex as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const sent = Transaction.fromPSBT(hex.decode(sentHex), {
      allowUnknown: true,
    });
    expect(sent.getInput(0).sighashType).toBe(SigHash.SINGLE_ANYONECANPAY);
    expect(
      (signer.signPsbtHex as ReturnType<typeof vi.fn>).mock.calls[0][2],
    ).toEqual({ sighashTypes: { 0: SigHash.SINGLE_ANYONECANPAY } });
  });

  it("stamps ALL|ANYONECANPAY (0x81) for a kon-leaf input", async () => {
    // The launch format signs direct transactions through the `kon` TapScript
    // leaf under 0x81 — the kind rc.6 did not know.
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);

    await signing.psbt(taprootPsbt(), {
      inputs: [{ index: 0, sighash: "all-anyonecanpay" }],
    });

    const [sentHex, indices, options] = (
      signer.signPsbtHex as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, number[], unknown];
    const sent = Transaction.fromPSBT(hex.decode(sentHex), {
      allowUnknown: true,
    });
    expect(sent.getInput(0).sighashType).toBe(SigHash.ALL_ANYONECANPAY);
    expect(indices).toEqual([0]);
    expect(options).toEqual({ sighashTypes: { 0: 0x81 } });
  });

  it("returns the PSBT unchanged for an empty input set (no wallet prompt)", async () => {
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);
    const psbt = taprootPsbt();

    const out = await signing.psbt(psbt, { inputs: [] });

    expect(hex.encode(out)).toBe(hex.encode(psbt));
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("refuses a psbt() call without an explicit inputs spec", async () => {
    const signing = createWalletKontorSigning(stubSigner(), signet);
    await expect(signing.psbt(taprootPsbt())).rejects.toThrow(/explicit .*inputs/);
  });

  it("keeps a different sighash per input in one request", async () => {
    // A delist's revoke: the escrow's script-path input under 0x81 and a
    // key-path fee input under SIGHASH_DEFAULT, signed in one psbt() call.
    // rc.6 refused this outright; collapsing it to one sighash would make the
    // SDK reject both signatures.
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);

    await signing.psbt(twoInputPsbt(X_ONLY), {
      inputs: [{ index: 0, sighash: "all-anyonecanpay" }, { index: 1 }],
    });

    const [sentHex, indices, options] = (
      signer.signPsbtHex as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, number[], unknown];
    const sent = Transaction.fromPSBT(hex.decode(sentHex), {
      allowUnknown: true,
    });
    expect(sent.getInput(0).sighashType).toBe(SigHash.ALL_ANYONECANPAY);
    // The default input is left untouched, as Kontor's own adapter does.
    expect(sent.getInput(1).sighashType).toBeUndefined();
    expect(indices).toEqual([0, 1]);
    expect(options).toEqual({ sighashTypes: { 0: 0x81, 1: 0x00 } });
  });

  it("gets back a 0x81 leaf signature and a default key-path one from a wallet that honours the request", async () => {
    // A stand-in wallet that signs exactly what it is asked to, with a real
    // key: the adapter's request must be enough for it to produce what the
    // SDK verifies — a 65-byte leaf signature ending in 0x81, and a 64-byte
    // (SIGHASH_DEFAULT) key-path signature.
    const privateKey = "03".repeat(32);
    const wallet = new LocalSigner(privateKey, "testnet").getAddresses();
    const signer = stubSigner({
      getAddresses: () => wallet,
      signPsbtHex: vi.fn(
        (psbtHex: string, indices: number[], options?: SignPsbtHexOptions) => {
          const tx = Transaction.fromPSBT(hex.decode(psbtHex), {
            allowUnknown: true,
          });
          for (const index of indices) {
            tx.signIdx(hex.decode(privateKey), index, [
              options!.sighashTypes![index]!,
            ]);
          }
          return hex.encode(tx.toPSBT());
        },
      ),
    });
    const signing = createWalletKontorSigning(signer, signet);

    const signed = Transaction.fromPSBT(
      await signing.psbt(twoInputPsbt(wallet.xOnlyPubkey!), {
        inputs: [{ index: 0, sighash: "all-anyonecanpay" }, { index: 1 }],
      }),
      { allowUnknown: true },
    );

    const leafSig = signed.getInput(0).tapScriptSig?.[0]?.[1];
    expect(leafSig).toHaveLength(65);
    expect(leafSig![64]).toBe(SigHash.ALL_ANYONECANPAY);
    expect(signed.getInput(1).tapKeySig).toHaveLength(64);
  });

  it("refuses a sighash kind it does not know rather than guess", async () => {
    const signing = createWalletKontorSigning(stubSigner(), signet);
    await expect(
      signing.psbt(taprootPsbt(), {
        inputs: [{ index: 0, sighash: "none" as never }],
      }),
    ).rejects.toThrow(/unsupported sighash "none"/);
  });

  it("delegates message signing to the wallet under the identity address", async () => {
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);

    const sig = await signing.message!("hello");

    expect(sig).toBe("sig-base64");
    expect(signer.signMessage).toHaveBeenCalledWith(P2TR, "hello");
  });

  it("hex-encodes a byte message before delegating", async () => {
    const signer = stubSigner();
    const signing = createWalletKontorSigning(signer, signet);

    await signing.message!(new Uint8Array([0xde, 0xad]));

    expect(signer.signMessage).toHaveBeenCalledWith(P2TR, "dead");
  });

  it("requires a Taproot address and x-only key", () => {
    const signer = stubSigner({
      getAddresses: () => ({ p2wpkh: "tb1qseg", publicKey: "00" }),
    });
    expect(() => createWalletKontorSigning(signer, signet)).toThrow(
      /Taproot .*x-only public key/,
    );
  });

  it("rejects an x-only key whose derived address is not the wallet's P2TR", () => {
    const signer = stubSigner({
      getAddresses: () => ({
        p2wpkh: "tb1qseg",
        // A valid taproot address for a DIFFERENT key than xOnlyPubkey → guards
        // against passing the tweaked OUTPUT key (or a wrong-network address) as
        // the identity.
        p2tr: OTHER_P2TR,
        publicKey: "00",
        xOnlyPubkey: X_ONLY,
      }),
    });
    expect(() => createWalletKontorSigning(signer, signet)).toThrow(
      /does not match the wallet's P2TR/,
    );
  });
});
