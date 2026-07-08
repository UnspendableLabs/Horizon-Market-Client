import fs from "node:fs";
import path from "node:path";
import { CliError } from "./output.js";
import type { UiNetwork } from "./networks.js";

/**
 * On-disk keystore record. `publicKey` / `addresses` are stored in the CLEAR so
 * read-only commands (`list`, `balances`) work without a password; the mnemonic
 * itself lives ONLY inside `keystore` — an encrypted blob produced by the SDK's
 * `encryptKeystore` (scrypt + AES-256-GCM). This module does file I/O only; all
 * encryption is delegated to the SDK.
 *
 * Addresses are pre-derived for BOTH networks at `init` time (the wallet is a
 * single key; only the address prefix differs by network), so a read-only
 * command with a `--network` override resolves addresses keylessly.
 */
export interface StoredKeystore {
  version: 1;
  /** The network chosen at init (the default when no `--network` override). */
  network: UiNetwork;
  /** BIP32 derivation path used at init. */
  path: string;
  /** Compressed secp256k1 public key hex (network-independent). */
  publicKey: string;
  /** x-only public key hex (network-independent). */
  xOnlyPubkey: string;
  /** p2wpkh + p2tr addresses per SDK network. */
  addresses: {
    mainnet: { p2wpkh: string; p2tr: string };
    testnet: { p2wpkh: string; p2tr: string };
  };
  createdAt: string;
  /** Encrypted mnemonic blob (SDK `encryptKeystore` output). */
  keystore: string;
}

/** Absolute path to the keystore JSON file inside `homeDir`. */
export function keystorePath(homeDir: string): string {
  return path.join(homeDir, "keystore.json");
}

/** True when a keystore file already exists in `homeDir`. */
export function keystoreExists(homeDir: string): boolean {
  return fs.existsSync(keystorePath(homeDir));
}

/** Read + parse the keystore, or null when none exists. */
export function readKeystore(homeDir: string): StoredKeystore | null {
  const file = keystorePath(homeDir);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new CliError(`Corrupt keystore at ${file} (invalid JSON)`, "KEYSTORE_CORRUPT");
  }
  const ks = parsed as StoredKeystore;
  if (ks?.version !== 1 || !ks.keystore || !ks.addresses) {
    throw new CliError(`Unrecognized keystore format at ${file}`, "KEYSTORE_CORRUPT");
  }
  return ks;
}

/** Load the keystore or throw a clean "run init" error. */
export function requireKeystore(homeDir: string): StoredKeystore {
  const ks = readKeystore(homeDir);
  if (!ks) {
    throw new CliError(
      `No keystore found in ${homeDir}. Run "horizon init" first.`,
      "NO_KEYSTORE",
    );
  }
  return ks;
}

/**
 * Write the keystore with a `0700` directory and a `0600` file.
 *
 * The write is ATOMIC: the file holds the only copy of the encrypted mnemonic,
 * so a crash mid-write must never truncate an existing keystore. We write a
 * sibling temp file (`0600`), fsync it, then `rename` it over the target — an
 * atomic replace on POSIX — instead of overwriting in place.
 */
export function writeKeystore(homeDir: string, data: StoredKeystore): void {
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  // mkdir honors `mode` only on creation; enforce perms even on a pre-existing dir.
  fs.chmodSync(homeDir, 0o700);

  const file = keystorePath(homeDir);
  const tmp = `${file}.${process.pid.toString()}.${Date.now().toString()}.tmp`;
  const body = JSON.stringify(data, null, 2) + "\n";

  // `wx` → fail if the unique temp name somehow exists; create it `0600` up front.
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  // rename preserves the temp's 0600; re-assert it to be explicit.
  fs.chmodSync(file, 0o600);
}
