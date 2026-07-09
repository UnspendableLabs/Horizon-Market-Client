import { HDKey } from "@scure/bip32";
import {
  generateMnemonic as bip39GenerateMnemonic,
  validateMnemonic as bip39ValidateMnemonic,
  mnemonicToSeedSync,
  entropyToMnemonic,
  mnemonicToEntropy,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Default BIP86 (single-key taproot) derivation path. `coin_type` is fixed to 0
 * (Bitcoin) — the network is chosen at address-derivation time, not by the path.
 * One derived key backs BOTH the p2wpkh and p2tr address, matching the wallet
 * model used by web3auth (a raw social-login key with no HD tree).
 *
 * For a full BIP39 mnemonic, prefer {@link deriveHorizonWalletKeys} /
 * {@link HDSigner}, which follow the Horizon Wallet browser-extension convention
 * (separate BIP84 + BIP86 keys, coin-type per network).
 */
export const DEFAULT_DERIVATION_PATH = "m/86'/0'/0'/0/0";

/** BIP purpose for native SegWit (p2wpkh) — BIP84. */
export const SEGWIT_PURPOSE = 84;
/** BIP purpose for single-key Taproot (p2tr) — BIP86. */
export const TAPROOT_PURPOSE = 86;

/**
 * SLIP-0044 `coin_type` for a network, matching the Horizon Wallet extension:
 * `0'` on mainnet, `1'` on testnet/signet.
 */
export function coinTypeForNetwork(network: "mainnet" | "testnet"): 0 | 1 {
  return network === "mainnet" ? 0 : 1;
}

/**
 * Build a Horizon-Wallet-style BIP32 path: `m/<purpose>'/<coin>'/<account>'/0/0`
 * (external chain, first index). `coin` follows the network per
 * {@link coinTypeForNetwork}.
 */
export function horizonWalletPath(
  purpose: number,
  network: "mainnet" | "testnet",
  account = 0,
): string {
  return `m/${purpose}'/${coinTypeForNetwork(network)}'/${account}'/0/0`;
}

/** Options controlling how a mnemonic is turned into a private key. */
export interface MnemonicDeriveOptions {
  /** BIP32 derivation path. Defaults to {@link DEFAULT_DERIVATION_PATH}. */
  path?: string;
  /** Optional BIP39 passphrase ("25th word"). Defaults to "". */
  passphrase?: string;
}

/** Options for deriving Horizon-Wallet-compatible keys from a mnemonic. */
export interface HorizonWalletDeriveOptions {
  /** Bitcoin network — selects `coin_type` (`0'` mainnet, `1'` testnet). Default "mainnet". */
  network?: "mainnet" | "testnet";
  /** BIP32 `account` index (the hardened `<account>'` level). Default 0. */
  account?: number;
  /** Optional BIP39 passphrase ("25th word"). Defaults to "". */
  passphrase?: string;
}

/** One derived key: its raw private key (hex) and the BIP32 path it came from. */
export interface DerivedKey {
  /** Raw secp256k1 private key, lowercase hex. */
  privateKeyHex: string;
  /** The BIP32 path this key was derived at. */
  path: string;
}

/** The BIP84 (segwit) + BIP86 (taproot) key pair for a Horizon Wallet account. */
export interface HorizonWalletKeys {
  /** Backs the p2wpkh (SegWit) address — derived at BIP84 `m/84'/…`. */
  segwit: DerivedKey;
  /** Backs the p2tr (Taproot) address — derived at BIP86 `m/86'/…`. */
  taproot: DerivedKey;
}

/**
 * Derive the two keys the Horizon Wallet browser extension uses for an account:
 * a BIP84 key (`m/84'/<coin>'/<account>'/0/0`) backing the SegWit address and a
 * BIP86 key (`m/86'/<coin>'/<account>'/0/0`) backing the Taproot address, with
 * `coin_type` chosen from the network. Feed the result to {@link HDSigner}.
 *
 * @throws if the mnemonic is invalid or a derived node has no private key.
 */
export function deriveHorizonWalletKeys(
  mnemonic: string,
  opts: HorizonWalletDeriveOptions = {},
): HorizonWalletKeys {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic: failed BIP39 checksum/wordlist check.");
  }
  const network = opts.network ?? "mainnet";
  const account = opts.account ?? 0;
  const seed = mnemonicToSeedSync(mnemonic, opts.passphrase ?? "");
  const master = HDKey.fromMasterSeed(seed);

  const derive = (purpose: number): DerivedKey => {
    const path = horizonWalletPath(purpose, network, account);
    const node = master.derive(path);
    if (!node.privateKey) {
      throw new Error(
        `Derived BIP32 node at ${path} has no private key (hardened public node?).`,
      );
    }
    return { privateKeyHex: bytesToHex(node.privateKey), path };
  };

  return { segwit: derive(SEGWIT_PURPOSE), taproot: derive(TAPROOT_PURPOSE) };
}

/**
 * Generate a fresh BIP39 mnemonic (English wordlist).
 *
 * @param strength Entropy in bits — 128 → 12 words, 256 → 24 words. Default 256.
 */
export function generateMnemonic(strength: 128 | 256 = 256): string {
  return bip39GenerateMnemonic(wordlist, strength);
}

/** Validate a BIP39 mnemonic (wordlist membership + checksum). */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39ValidateMnemonic(mnemonic, wordlist);
}

/** Options for {@link privateKeyToMnemonic}. */
export interface PrivateKeyToMnemonicOptions {
  /**
   * Phrase length. `24` (default) uses the full 32-byte key as 256-bit entropy —
   * a lossless, reversible encoding ({@link mnemonicToPrivateKeyEntropy}).
   * `12` reduces the key to 128-bit entropy — required to import into wallets
   * that only accept 12-word phrases (e.g. the Horizon Wallet extension). See
   * the reduction note below; a 12-word phrase encodes a DIFFERENT wallet than
   * the 24-word one (different seed → different addresses).
   */
  words?: 12 | 24;
}

/**
 * Encode a raw 32-byte secp256k1 private key as a BIP39 mnemonic, using the key
 * (or a reduction of it) as BIP39 entropy.
 *
 * This is the canonical bridge from the web3auth single-key wallets to the
 * mnemonic-based Horizon Wallet convention: a web/native app can turn its
 * web3auth key into this mnemonic, and {@link deriveHorizonWalletKeys} /
 * `HDSigner.fromMnemonic` will then derive the SAME p2wpkh + p2tr addresses that
 * importing the phrase into Horizon Wallet / XVerse produces. NOTE: the derived
 * keys come from the mnemonic's BIP39 *seed*, not from the original key — so an
 * app that adopts this bridge must derive its displayed addresses from the
 * mnemonic too, not from the raw key.
 *
 * ── 12 vs 24 words ──────────────────────────────────────────────────────────
 * BIP39 maps 256-bit entropy → 24 words and 128-bit entropy → 12 words. The
 * web3auth key is 256-bit, so:
 *   - `words: 24` (default) uses the key verbatim as entropy → reversible via
 *     {@link mnemonicToPrivateKeyEntropy}. Importable into 24-word wallets
 *     (XVerse, etc.), NOT the 12-word-only Horizon Wallet extension.
 *   - `words: 12` derives 128-bit entropy as `sha256(key)[:16]` — a stable,
 *     one-way reduction (chosen over raw truncation so the phrase leaks no bytes
 *     of the actual key). Importable into the Horizon Wallet extension (and any
 *     12-word wallet). Because it is a DIFFERENT 128-bit seed, its addresses
 *     differ from the 24-word phrase's — the two are distinct wallets. Not
 *     reversible: recover it by re-reducing the original key, not from the phrase.
 *
 * @throws if the key is not exactly 32 bytes.
 */
export function privateKeyToMnemonic(
  privateKey: string | Uint8Array,
  opts: PrivateKeyToMnemonicOptions = {},
): string {
  const bytes =
    typeof privateKey === "string"
      ? hexToBytes(privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey)
      : privateKey;
  if (bytes.length !== 32) {
    throw new Error(
      `Expected a 32-byte private key to encode as a mnemonic, got ${bytes.length} bytes.`,
    );
  }
  // 12 words → 128-bit entropy. sha256(key)[:16] keeps the reduction stable and
  // decorrelated from the raw key (so the plaintext phrase reveals no key bytes).
  const entropy =
    (opts.words ?? 24) === 12 ? sha256(bytes).slice(0, 16) : bytes;
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * Recover the raw entropy (hex) a mnemonic encodes — the inverse of
 * {@link privateKeyToMnemonic} for 24-word mnemonics. Returns the 32-byte hex
 * that was used as entropy (i.e. the original web3auth private key).
 *
 * @throws if the mnemonic is invalid.
 */
export function mnemonicToPrivateKeyEntropy(mnemonic: string): string {
  return bytesToHex(mnemonicToEntropy(mnemonic, wordlist));
}

/**
 * Derive a raw secp256k1 private key (hex) from a BIP39 mnemonic.
 *
 * Validates the mnemonic → derives the BIP39 seed (with optional passphrase) →
 * derives the BIP32 node at `path` (default {@link DEFAULT_DERIVATION_PATH}) →
 * returns its private key as a lowercase hex string. Feed the result to
 * `new LocalSigner(pk, network)` (or use {@link LocalSigner.fromMnemonic}).
 *
 * @throws if the mnemonic is invalid or the derived node has no private key.
 */
export function mnemonicToPrivateKey(
  mnemonic: string,
  opts: MnemonicDeriveOptions = {},
): string {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic: failed BIP39 checksum/wordlist check.");
  }
  const seed = mnemonicToSeedSync(mnemonic, opts.passphrase ?? "");
  const node = HDKey.fromMasterSeed(seed).derive(
    opts.path ?? DEFAULT_DERIVATION_PATH,
  );
  if (!node.privateKey) {
    throw new Error(
      "Derived BIP32 node has no private key (path resolved to a hardened public node?).",
    );
  }
  return bytesToHex(node.privateKey);
}
