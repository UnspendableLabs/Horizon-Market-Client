import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encryptKeystore,
  DEFAULT_DERIVATION_PATH,
} from "@unspendablelabs/horizon-market-client";
import { deriveWallet, unlockWallet } from "./wallet.js";
import { writeKeystore, requireKeystore, type StoredKeystore } from "./keystore.js";

// BIP86 golden vector (same as the SDK's crypto/mnemonic.test.ts).
const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const GOLDEN = {
  publicKey: "03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  xOnlyPubkey: "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  mainnet: {
    p2wpkh: "bc1qalwlmdxd2ggue4290ekzxl9tetg56neexr6amw",
    p2tr: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  },
  testnet: {
    p2wpkh: "tb1qalwlmdxd2ggue4290ekzxl9tetg56neev9pwqa",
    p2tr: "tb1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqp3mvzv",
  },
};

const PASSWORD = "correct horse battery staple";

describe("deriveWallet", () => {
  it("derives the golden pubkeys and both addresses for both networks", () => {
    const w = deriveWallet(VECTOR_MNEMONIC);
    expect(w.publicKey).toBe(GOLDEN.publicKey);
    expect(w.xOnlyPubkey).toBe(GOLDEN.xOnlyPubkey);
    expect(w.addresses.mainnet).toEqual(GOLDEN.mainnet);
    expect(w.addresses.testnet).toEqual(GOLDEN.testnet);
  });

  it("re-importing the same mnemonic yields identical addresses (stable derivation)", () => {
    expect(deriveWallet(VECTOR_MNEMONIC).addresses).toEqual(
      deriveWallet(VECTOR_MNEMONIC).addresses,
    );
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
      version: 1,
      network: "mainnet",
      path: DEFAULT_DERIVATION_PATH,
      publicKey: wallet.publicKey,
      xOnlyPubkey: wallet.xOnlyPubkey,
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
    expect(unlocked.signer.getAddresses().publicKey).toBe(GOLDEN.publicKey);
    expect(unlocked.mnemonicOptions).toEqual({ path: DEFAULT_DERIVATION_PATH });
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

  it("detects a missing BIP39 passphrase via the pubkey mismatch guard", async () => {
    // Keystore was created WITHOUT a passphrase; unlocking WITH one re-derives a
    // different key, which the guard catches.
    await initKeystore();
    await expect(
      unlockWallet(requireKeystore(home), PASSWORD, "mainnet", "surprise"),
    ).rejects.toMatchObject({ code: "DERIVATION_MISMATCH" });
  });
});
