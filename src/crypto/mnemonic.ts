import { HDKey } from "@scure/bip32";
import {
  generateMnemonic as bip39GenerateMnemonic,
  validateMnemonic as bip39ValidateMnemonic,
  mnemonicToSeedSync,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Default BIP86 (single-key taproot) derivation path. `coin_type` is fixed to 0
 * (Bitcoin) — the network is chosen at address-derivation time, not by the path.
 * One derived key backs BOTH the p2wpkh and p2tr address, matching the wallet
 * model used by the example apps (web3auth).
 */
export const DEFAULT_DERIVATION_PATH = "m/86'/0'/0'/0/0";

/** Options controlling how a mnemonic is turned into a private key. */
export interface MnemonicDeriveOptions {
  /** BIP32 derivation path. Defaults to {@link DEFAULT_DERIVATION_PATH}. */
  path?: string;
  /** Optional BIP39 passphrase ("25th word"). Defaults to "". */
  passphrase?: string;
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
