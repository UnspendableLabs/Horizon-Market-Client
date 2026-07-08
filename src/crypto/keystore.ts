import { scrypt } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";
import {
  randomBytes,
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from "@noble/hashes/utils.js";

/**
 * Cross-platform encrypted keystore helpers (string → string, NO file I/O).
 *
 * Pure-JS crypto only — scrypt (`@noble/hashes`) + AES-256-GCM (`@noble/ciphers`)
 * + CSPRNG (`@noble/hashes` `randomBytes`, backed by `crypto.getRandomValues`).
 * No `node:crypto`, no `fs`, no WASM → usable in Node, the browser (Vite) and
 * React Native / Hermes (with the `react-native-get-random-values` polyfill).
 *
 * The consumer owns storage: the CLI writes the returned string to a `0600`
 * file, the native app to `expo-secure-store`, a web app to `localStorage`.
 */

/** Serialized encrypted keystore blob (JSON-stringified by {@link encryptKeystore}). */
export interface Keystore {
  /** Format version. Currently always `1`. */
  version: number;
  /** Key-derivation parameters. `salt` is hex-encoded. */
  kdf: {
    name: "scrypt";
    N: number;
    r: number;
    p: number;
    salt: string;
  };
  /** AEAD cipher identifier. */
  cipher: "aes-256-gcm";
  /** Hex-encoded 12-byte GCM nonce. */
  iv: string;
  /** Hex-encoded AES-256-GCM output (ciphertext with the 16-byte auth tag appended). */
  ciphertext: string;
}

/** Overridable scrypt work factors (defaults are the OWASP-recommended set). */
export interface EncryptKeystoreOptions {
  /** CPU/memory cost. Must be a power of two. Default `2 ** 15`. */
  N?: number;
  /** Block size. Default `8`. */
  r?: number;
  /** Parallelization. Default `1`. */
  p?: number;
}

const KEYSTORE_VERSION = 1;
const DEFAULT_N = 2 ** 15;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const DK_LEN = 32; // AES-256 key
const SALT_LEN = 16;
const IV_LEN = 12; // GCM standard nonce length

function deriveKey(
  password: string,
  salt: Uint8Array,
  N: number,
  r: number,
  p: number,
): Uint8Array {
  return scrypt(utf8ToBytes(password), salt, { N, r, p, dkLen: DK_LEN });
}

/**
 * Encrypt an arbitrary secret string (e.g. a mnemonic) under a password.
 *
 * Derives an AES-256 key from `password` via scrypt (fresh random salt), then
 * seals `secret` with AES-256-GCM (fresh random 12-byte nonce). Returns the
 * self-describing keystore as a JSON string — hand it to your own storage.
 */
export async function encryptKeystore(
  secret: string,
  password: string,
  opts: EncryptKeystoreOptions = {},
): Promise<string> {
  const N = opts.N ?? DEFAULT_N;
  const r = opts.r ?? DEFAULT_R;
  const p = opts.p ?? DEFAULT_P;

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt, N, r, p);
  const ciphertext = gcm(key, iv).encrypt(utf8ToBytes(secret));

  const keystore: Keystore = {
    version: KEYSTORE_VERSION,
    kdf: { name: "scrypt", N, r, p, salt: bytesToHex(salt) },
    cipher: "aes-256-gcm",
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
  };
  return JSON.stringify(keystore);
}

/**
 * Decrypt a keystore produced by {@link encryptKeystore}.
 *
 * @throws if the JSON is malformed/unsupported, the password is wrong, or the
 *   ciphertext was tampered with (GCM authentication failure).
 */
export async function decryptKeystore(
  json: string,
  password: string,
): Promise<string> {
  let ks: Keystore;
  try {
    ks = JSON.parse(json) as Keystore;
  } catch {
    throw new Error("Invalid keystore: not valid JSON.");
  }

  if (ks.version !== KEYSTORE_VERSION) {
    throw new Error(`Unsupported keystore version: ${String(ks.version)}.`);
  }
  if (ks.kdf?.name !== "scrypt") {
    throw new Error(`Unsupported KDF: ${String(ks.kdf?.name)}.`);
  }
  if (ks.cipher !== "aes-256-gcm") {
    throw new Error(`Unsupported cipher: ${String(ks.cipher)}.`);
  }

  const key = deriveKey(
    password,
    hexToBytes(ks.kdf.salt),
    ks.kdf.N,
    ks.kdf.r,
    ks.kdf.p,
  );

  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, hexToBytes(ks.iv)).decrypt(hexToBytes(ks.ciphertext));
  } catch {
    // GCM tag mismatch → wrong password or tampered ciphertext.
    throw new Error("Failed to decrypt keystore: wrong password or corrupt data.");
  }
  return new TextDecoder().decode(plaintext);
}
