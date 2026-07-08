import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptKeystore } from "@unspendablelabs/horizon-market-client";
import { deriveWallet, unlockWallet } from "./wallet.js";
import { writeKeystore, requireKeystore, type StoredKeystore } from "./keystore.js";

// Horizon-Wallet golden vector (BIP84 segwit + BIP86 taproot, coin-type per
// network, account 0). p2tr matches the SDK's crypto/mnemonic.test.ts BIP86
// vector; p2wpkh comes from the BIP84 path m/84'/<coin>'/0'/0/0.
const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const GOLDEN = {
  // Compressed pubkey of the SegWit (BIP84) key; x-only of the Taproot (BIP86) key.
  segwitPublicKey:
    "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
  mainnet: {
    p2wpkh: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    p2tr: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  },
  testnet: {
    p2wpkh: "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl",
    p2tr: "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj",
  },
};

const PASSWORD = "correct horse battery staple";

describe("deriveWallet", () => {
  it("derives the golden Horizon-Wallet addresses for both networks", () => {
    const w = deriveWallet(VECTOR_MNEMONIC);
    expect(w.addresses.mainnet).toEqual(GOLDEN.mainnet);
    expect(w.addresses.testnet).toEqual(GOLDEN.testnet);
  });

  it("re-importing the same mnemonic yields identical addresses (stable derivation)", () => {
    expect(deriveWallet(VECTOR_MNEMONIC).addresses).toEqual(
      deriveWallet(VECTOR_MNEMONIC).addresses,
    );
  });

  it("a different account index yields different addresses", () => {
    const a0 = deriveWallet(VECTOR_MNEMONIC, { account: 0 }).addresses;
    const a1 = deriveWallet(VECTOR_MNEMONIC, { account: 1 }).addresses;
    expect(a1.mainnet.p2wpkh).not.toBe(a0.mainnet.p2wpkh);
    expect(a1.mainnet.p2tr).not.toBe(a0.mainnet.p2tr);
  });
});

describe("init → unlock round-trip", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "horizon-cli-wallet-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function initKeystore(passphrase?: string): Promise<StoredKeystore> {
    const wallet = deriveWallet(VECTOR_MNEMONIC, { passphrase });
    const blob = await encryptKeystore(VECTOR_MNEMONIC, PASSWORD);
    const stored: StoredKeystore = {
      version: 2,
      network: "mainnet",
      account: 0,
      addresses: wallet.addresses,
      createdAt: new Date().toISOString(),
      keystore: blob,
    };
    writeKeystore(home, stored);
    return stored;
  }

  it("decrypts the mnemonic and rebuilds the matching signer", async () => {
    await initKeystore();
    const stored = requireKeystore(home);
    const unlocked = await unlockWallet(stored, PASSWORD, "mainnet", undefined);

    expect(unlocked.mnemonic).toBe(VECTOR_MNEMONIC);
    expect(unlocked.addresses).toEqual(GOLDEN.mainnet);
    expect(unlocked.signer.getAddresses().publicKey).toBe(GOLDEN.segwitPublicKey);
    expect(unlocked.mnemonicOptions).toEqual({ account: 0 });
  });

  it("rebuilds testnet addresses when unlocking on signet", async () => {
    await initKeystore();
    const unlocked = await unlockWallet(requireKeystore(home), PASSWORD, "testnet", undefined);
    expect(unlocked.addresses).toEqual(GOLDEN.testnet);
  });

  it("throws on the wrong password (GCM auth failure)", async () => {
    await initKeystore();
    await expect(
      unlockWallet(requireKeystore(home), "wrong password", "mainnet", undefined),
    ).rejects.toThrow(/wrong password or corrupt data/);
  });

  it("detects a missing BIP39 passphrase via the address mismatch guard", async () => {
    // Keystore was created WITHOUT a passphrase; unlocking WITH one re-derives
    // different keys, which the guard catches.
    await initKeystore();
    await expect(
      unlockWallet(requireKeystore(home), PASSWORD, "mainnet", "surprise"),
    ).rejects.toMatchObject({ code: "DERIVATION_MISMATCH" });
  });
});
