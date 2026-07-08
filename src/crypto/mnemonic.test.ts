import { describe, it, expect } from "vitest";
import {
  generateMnemonic,
  validateMnemonic,
  mnemonicToPrivateKey,
  DEFAULT_DERIVATION_PATH,
} from "./mnemonic.js";
import { LocalSigner } from "./signer.js";

// Canonical BIP86 test vector mnemonic (12 words, all-"abandon" + "about").
const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Golden values locked from running the derivation once (see also the published
// BIP86 reference vectors: the private key and first receive p2tr address match).
const VECTOR = {
  privateKey:
    "41f41d69260df4cf277826a9b65a3717e4eeddbeedf637f212ca096576479361",
  publicKey:
    "03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  xOnlyPubkey:
    "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  mainnet: {
    p2wpkh: "bc1qalwlmdxd2ggue4290ekzxl9tetg56neexr6amw",
    p2tr: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  },
  testnet: {
    p2wpkh: "tb1qalwlmdxd2ggue4290ekzxl9tetg56neev9pwqa",
    p2tr: "tb1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqp3mvzv",
  },
} as const;

describe("DEFAULT_DERIVATION_PATH", () => {
  it("is the BIP86 single-key taproot path", () => {
    expect(DEFAULT_DERIVATION_PATH).toBe("m/86'/0'/0'/0/0");
  });
});

describe("mnemonicToPrivateKey", () => {
  it("derives the golden private key at the default path", () => {
    expect(mnemonicToPrivateKey(VECTOR_MNEMONIC)).toBe(VECTOR.privateKey);
  });

  it("matches an explicit default path", () => {
    expect(
      mnemonicToPrivateKey(VECTOR_MNEMONIC, { path: DEFAULT_DERIVATION_PATH }),
    ).toBe(VECTOR.privateKey);
  });

  it("derives a different key for a different path", () => {
    expect(mnemonicToPrivateKey(VECTOR_MNEMONIC, { path: "m/86'/0'/0'/0/1" })).not.toBe(
      VECTOR.privateKey,
    );
  });

  it("derives a different key when a passphrase is set", () => {
    expect(
      mnemonicToPrivateKey(VECTOR_MNEMONIC, { passphrase: "hunter2" }),
    ).not.toBe(VECTOR.privateKey);
  });

  it("throws on an invalid mnemonic", () => {
    expect(() => mnemonicToPrivateKey("not a real mnemonic")).toThrow(/Invalid mnemonic/);
  });
});

describe("golden address vector (via LocalSigner)", () => {
  it("derives the expected mainnet p2wpkh + p2tr", () => {
    const signer = new LocalSigner(
      mnemonicToPrivateKey(VECTOR_MNEMONIC),
      "mainnet",
    );
    const addrs = signer.getAddresses();
    expect(addrs.p2wpkh).toBe(VECTOR.mainnet.p2wpkh);
    expect(addrs.p2tr).toBe(VECTOR.mainnet.p2tr);
    expect(addrs.publicKey).toBe(VECTOR.publicKey);
    expect(addrs.xOnlyPubkey).toBe(VECTOR.xOnlyPubkey);
  });

  it("derives the expected testnet p2wpkh + p2tr", () => {
    const signer = new LocalSigner(
      mnemonicToPrivateKey(VECTOR_MNEMONIC),
      "testnet",
    );
    const addrs = signer.getAddresses();
    expect(addrs.p2wpkh).toBe(VECTOR.testnet.p2wpkh);
    expect(addrs.p2tr).toBe(VECTOR.testnet.p2tr);
  });
});

describe("LocalSigner.fromMnemonic", () => {
  it("is equivalent to mnemonicToPrivateKey + new LocalSigner (both addresses)", () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const fromFactory = LocalSigner.fromMnemonic(VECTOR_MNEMONIC, {
        network,
      }).getAddresses();
      const fromRaw = new LocalSigner(
        mnemonicToPrivateKey(VECTOR_MNEMONIC),
        network,
      ).getAddresses();
      expect(fromFactory).toEqual(fromRaw);
      expect(fromFactory.p2wpkh).toBe(VECTOR[network].p2wpkh);
      expect(fromFactory.p2tr).toBe(VECTOR[network].p2tr);
    }
  });

  it("defaults to mainnet when no network is given", () => {
    const addrs = LocalSigner.fromMnemonic(VECTOR_MNEMONIC).getAddresses();
    expect(addrs.p2wpkh).toBe(VECTOR.mainnet.p2wpkh);
    expect(addrs.p2tr).toBe(VECTOR.mainnet.p2tr);
  });

  it("honors path/passphrase overrides", () => {
    const overridden = LocalSigner.fromMnemonic(VECTOR_MNEMONIC, {
      network: "mainnet",
      passphrase: "hunter2",
    }).getAddresses();
    expect(overridden.p2wpkh).not.toBe(VECTOR.mainnet.p2wpkh);
  });
});

describe("generateMnemonic", () => {
  it("produces 24 words by default (256-bit entropy) that validate", () => {
    const m = generateMnemonic();
    expect(m.trim().split(/\s+/)).toHaveLength(24);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("produces 12 words for 128-bit entropy", () => {
    const m = generateMnemonic(128);
    expect(m.trim().split(/\s+/)).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("produces distinct mnemonics across calls", () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });
});

describe("validateMnemonic", () => {
  it("accepts the golden vector mnemonic", () => {
    expect(validateMnemonic(VECTOR_MNEMONIC)).toBe(true);
  });

  it("rejects a mnemonic with an invalid checksum", () => {
    // Swapping the last word breaks the BIP39 checksum.
    const bad =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
    expect(validateMnemonic(bad)).toBe(false);
  });

  it("rejects non-wordlist input", () => {
    expect(validateMnemonic("hello world foo bar")).toBe(false);
  });
});
