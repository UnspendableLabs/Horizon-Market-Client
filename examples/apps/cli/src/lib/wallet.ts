import {
  LocalSigner,
  decryptKeystore,
} from "@unspendablelabs/horizon-market-client";
import { CliError } from "./output.js";
import type { StoredKeystore } from "./keystore.js";

/** A pair of derived Bitcoin addresses for one SDK network. */
export interface AddressPair {
  p2wpkh: string;
  p2tr: string;
}

/** Everything derived from a mnemonic at init time (address maps + pubkeys). */
export interface DerivedWallet {
  publicKey: string;
  xOnlyPubkey: string;
  addresses: StoredKeystore["addresses"];
}

function pair(signer: LocalSigner): AddressPair {
  const a = signer.getAddresses();
  if (!a.p2tr) throw new CliError("Failed to derive a P2TR address", "DERIVE_FAILED");
  return { p2wpkh: a.p2wpkh, p2tr: a.p2tr };
}

/**
 * Derive the wallet material from a mnemonic: the compressed / x-only pubkeys
 * (network-independent) and the p2wpkh + p2tr addresses for BOTH SDK networks.
 * Uses the SDK's `LocalSigner.fromMnemonic` — no crypto is re-implemented here.
 */
export function deriveWallet(
  mnemonic: string,
  opts: { path?: string; passphrase?: string } = {},
): DerivedWallet {
  const mainnet = LocalSigner.fromMnemonic(mnemonic, { network: "mainnet", ...opts });
  const testnet = LocalSigner.fromMnemonic(mnemonic, { network: "testnet", ...opts });
  const { publicKey, xOnlyPubkey } = mainnet.getAddresses();
  if (!xOnlyPubkey) {
    throw new CliError("Failed to derive an x-only pubkey", "DERIVE_FAILED");
  }
  return {
    publicKey,
    xOnlyPubkey,
    addresses: { mainnet: pair(mainnet), testnet: pair(testnet) },
  };
}

/** The stored address pair for a given SDK network (keyless — read-only safe). */
export function walletAddresses(
  stored: StoredKeystore,
  sdkNetwork: "mainnet" | "testnet",
): AddressPair {
  return stored.addresses[sdkNetwork];
}

/** Result of decrypting + re-deriving a wallet for a write operation. */
export interface UnlockedWallet {
  mnemonic: string;
  signer: LocalSigner;
  addresses: AddressPair;
  /** Derivation options to forward to `createClient` so the client's signer matches. */
  mnemonicOptions: { path: string; passphrase?: string };
}

/**
 * Decrypt the keystore's mnemonic with `password` (delegated to the SDK's
 * `decryptKeystore`) and rebuild the signer for `sdkNetwork`. Verifies the
 * re-derived public key matches the stored one — catching a wrong BIP39
 * passphrase (a wrong password already fails inside `decryptKeystore`).
 */
export async function unlockWallet(
  stored: StoredKeystore,
  password: string,
  sdkNetwork: "mainnet" | "testnet",
  passphrase: string | undefined,
): Promise<UnlockedWallet> {
  const mnemonic = await decryptKeystore(stored.keystore, password);
  const derivation = { path: stored.path, passphrase };
  const signer = LocalSigner.fromMnemonic(mnemonic, {
    network: sdkNetwork,
    ...derivation,
  });
  const addrs = signer.getAddresses();
  if (addrs.publicKey !== stored.publicKey) {
    // The re-derived key doesn't match the one stored at init. Either a BIP39
    // passphrase is missing, or a wrong/extra one is being applied — check the
    // --passphrase flag / $HORIZON_PASSPHRASE against how the wallet was created.
    throw new CliError(
      "Re-derived key does not match the stored wallet — check your BIP39 passphrase (--passphrase / $HORIZON_PASSPHRASE).",
      "DERIVATION_MISMATCH",
    );
  }
  return {
    mnemonic,
    signer,
    addresses: pair(signer),
    mnemonicOptions: passphrase ? { path: stored.path, passphrase } : { path: stored.path },
  };
}
