import { describe, it, expect } from "vitest";
import {
  deriveHorizonWalletKeys,
  horizonWalletPath,
  privateKeyToMnemonic,
  mnemonicToPrivateKeyEntropy,
  mnemonicToPrivateKey,
  validateMnemonic,
} from "./mnemonic.js";
import { HDSigner, LocalSigner } from "./signer.js";

const VECTOR_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Horizon-Wallet golden addresses (BIP84 segwit + BIP86 taproot, coin per net, account 0).
const GOLDEN = {
  mainnet: {
    p2wpkh: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    p2tr: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  },
  testnet: {
    p2wpkh: "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl",
    p2tr: "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj",
  },
} as const;

describe("horizonWalletPath / coin-type", () => {
  it("uses coin 0 on mainnet and 1 on testnet, at the given purpose/account", () => {
    expect(horizonWalletPath(84, "mainnet", 0)).toBe("m/84'/0'/0'/0/0");
    expect(horizonWalletPath(86, "mainnet", 0)).toBe("m/86'/0'/0'/0/0");
    expect(horizonWalletPath(84, "testnet", 0)).toBe("m/84'/1'/0'/0/0");
    expect(horizonWalletPath(86, "testnet", 2)).toBe("m/86'/1'/2'/0/0");
  });
});

describe("deriveHorizonWalletKeys", () => {
  it("derives distinct BIP84 (segwit) and BIP86 (taproot) keys at the right paths", () => {
    const k = deriveHorizonWalletKeys(VECTOR_MNEMONIC, { network: "mainnet" });
    expect(k.segwit.path).toBe("m/84'/0'/0'/0/0");
    expect(k.taproot.path).toBe("m/86'/0'/0'/0/0");
    expect(k.segwit.privateKeyHex).not.toBe(k.taproot.privateKeyHex);
  });

  it("the taproot key equals the legacy single-key BIP86 derivation", () => {
    // The old single-key model derived m/86'/0'/0'/0/0; HDSigner's taproot key
    // must be identical, so taproot addresses stay compatible with it.
    const k = deriveHorizonWalletKeys(VECTOR_MNEMONIC, { network: "mainnet" });
    expect(k.taproot.privateKeyHex).toBe(mnemonicToPrivateKey(VECTOR_MNEMONIC));
  });

  it("throws on an invalid mnemonic", () => {
    expect(() => deriveHorizonWalletKeys("not a real mnemonic")).toThrow(/Invalid mnemonic/);
  });
});

describe("HDSigner.fromMnemonic — Horizon Wallet golden addresses", () => {
  for (const network of ["mainnet", "testnet"] as const) {
    it(`derives the expected ${network} p2wpkh + p2tr`, () => {
      const addrs = HDSigner.fromMnemonic(VECTOR_MNEMONIC, { network }).getAddresses();
      expect(addrs.p2wpkh).toBe(GOLDEN[network].p2wpkh);
      expect(addrs.p2tr).toBe(GOLDEN[network].p2tr);
    });
  }

  it("p2tr matches the single-key LocalSigner (same BIP86 key), p2wpkh does not", () => {
    const hd = HDSigner.fromMnemonic(VECTOR_MNEMONIC, { network: "mainnet" }).getAddresses();
    const single = LocalSigner.fromMnemonic(VECTOR_MNEMONIC, {
      network: "mainnet",
    }).getAddresses();
    expect(hd.p2tr).toBe(single.p2tr);
    expect(hd.p2wpkh).not.toBe(single.p2wpkh);
  });

  it("a passphrase changes the addresses", () => {
    const withPass = HDSigner.fromMnemonic(VECTOR_MNEMONIC, {
      network: "mainnet",
      passphrase: "hunter2",
    }).getAddresses();
    expect(withPass.p2wpkh).not.toBe(GOLDEN.mainnet.p2wpkh);
    expect(withPass.p2tr).not.toBe(GOLDEN.mainnet.p2tr);
  });

  it("a different account index changes the addresses", () => {
    const a1 = HDSigner.fromMnemonic(VECTOR_MNEMONIC, {
      network: "mainnet",
      account: 1,
    }).getAddresses();
    expect(a1.p2wpkh).not.toBe(GOLDEN.mainnet.p2wpkh);
    expect(a1.p2tr).not.toBe(GOLDEN.mainnet.p2tr);
  });
});

describe("privateKeyToMnemonic (web3auth-key bridge)", () => {
  const RAW_KEY =
    "41f41d69260df4cf277826a9b65a3717e4eeddbeedf637f212ca096576479361";

  it("round-trips key → mnemonic → entropy", () => {
    const mnemonic = privateKeyToMnemonic(RAW_KEY);
    expect(mnemonic.trim().split(/\s+/)).toHaveLength(24);
    expect(mnemonicToPrivateKeyEntropy(mnemonic)).toBe(RAW_KEY);
  });

  it("accepts a 0x-prefixed key and raw bytes identically", () => {
    const fromHex = privateKeyToMnemonic("0x" + RAW_KEY);
    const fromBytes = privateKeyToMnemonic(
      Uint8Array.from(RAW_KEY.match(/../g)!.map((b) => parseInt(b, 16))),
    );
    expect(fromHex).toBe(fromBytes);
  });

  it("is deterministic: the same key always yields the same HDSigner addresses", () => {
    const a = HDSigner.fromMnemonic(privateKeyToMnemonic(RAW_KEY), {
      network: "mainnet",
    }).getAddresses();
    const b = HDSigner.fromMnemonic(privateKeyToMnemonic(RAW_KEY), {
      network: "mainnet",
    }).getAddresses();
    expect(a).toEqual(b);
  });

  it("rejects a non-32-byte key", () => {
    expect(() => privateKeyToMnemonic("dead")).toThrow(/32-byte/);
  });

  it("produces a valid 12-word phrase for words:12 (Horizon Wallet import)", () => {
    const mnemonic = privateKeyToMnemonic(RAW_KEY, { words: 12 });
    expect(mnemonic.trim().split(/\s+/)).toHaveLength(12);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it("is deterministic and 0x/bytes-agnostic for words:12", () => {
    const a = privateKeyToMnemonic("0x" + RAW_KEY, { words: 12 });
    const b = privateKeyToMnemonic(
      Uint8Array.from(RAW_KEY.match(/../g)!.map((h) => parseInt(h, 16))),
      { words: 12 },
    );
    expect(a).toBe(b);
    expect(a).toBe(privateKeyToMnemonic(RAW_KEY, { words: 12 }));
  });

  it("12- and 24-word phrases for the same key are different wallets", () => {
    const twelve = privateKeyToMnemonic(RAW_KEY, { words: 12 });
    const twentyFour = privateKeyToMnemonic(RAW_KEY, { words: 24 });
    expect(twelve).not.toBe(twentyFour);
    // 12-word entropy = sha256(key)[:16], so it does NOT invert back to the key.
    expect(mnemonicToPrivateKeyEntropy(twelve)).not.toBe(RAW_KEY);
    // 24-word entropy = the key verbatim → reversible.
    expect(mnemonicToPrivateKeyEntropy(twentyFour)).toBe(RAW_KEY);
  });
});

describe("HDSigner.fromPrivateKey (web3auth bridge, used by web/native)", () => {
  const RAW_KEY =
    "41f41d69260df4cf277826a9b65a3717e4eeddbeedf637f212ca096576479361";

  it("is exactly equivalent to fromMnemonic(privateKeyToMnemonic(key))", () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const viaKey = HDSigner.fromPrivateKey(RAW_KEY, { network }).getAddresses();
      const viaMnemonic = HDSigner.fromMnemonic(
        privateKeyToMnemonic(RAW_KEY),
        { network },
      ).getAddresses();
      expect(viaKey).toEqual(viaMnemonic);
    }
  });

  it("accepts a 0x prefix and raw bytes identically", () => {
    const a = HDSigner.fromPrivateKey("0x" + RAW_KEY, { network: "mainnet" }).getAddresses();
    const b = HDSigner.fromPrivateKey(
      Uint8Array.from(RAW_KEY.match(/../g)!.map((h) => parseInt(h, 16))),
      { network: "mainnet" },
    ).getAddresses();
    expect(a).toEqual(b);
  });

  it("differs from the legacy single-key LocalSigner for the same key", () => {
    const hd = HDSigner.fromPrivateKey(RAW_KEY, { network: "mainnet" }).getAddresses();
    const legacy = new LocalSigner(RAW_KEY, "mainnet").getAddresses();
    expect(hd.p2wpkh).not.toBe(legacy.p2wpkh);
    expect(hd.p2tr).not.toBe(legacy.p2tr);
  });

  it("words:12 matches the phrase importable into Horizon Wallet", () => {
    for (const network of ["mainnet", "testnet"] as const) {
      const viaKey = HDSigner.fromPrivateKey(RAW_KEY, {
        network,
        words: 12,
      }).getAddresses();
      // Exactly what a user would get typing the exported 12 words into a wallet.
      const viaPhrase = HDSigner.fromMnemonic(
        privateKeyToMnemonic(RAW_KEY, { words: 12 }),
        { network },
      ).getAddresses();
      expect(viaKey).toEqual(viaPhrase);
    }
  });

  it("words:12 and words:24 yield different addresses (distinct wallets)", () => {
    const twelve = HDSigner.fromPrivateKey(RAW_KEY, {
      network: "mainnet",
      words: 12,
    }).getAddresses();
    const twentyFour = HDSigner.fromPrivateKey(RAW_KEY, {
      network: "mainnet",
      words: 24,
    }).getAddresses();
    expect(twelve.p2wpkh).not.toBe(twentyFour.p2wpkh);
    expect(twelve.p2tr).not.toBe(twentyFour.p2tr);
  });
});
