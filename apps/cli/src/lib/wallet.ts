import {
  HDSigner,
  decryptKeystore,
} from "@unspendablelabs/horizon-market-client";
import { CliError } from "./output.js";
import type { StoredKeystore } from "./keystore.js";

/** A pair of derived Bitcoin addresses for one SDK network. */
export interface AddressPair {
  p2wpkh: string;
  p2tr: string;
}

/** Everything derived from a mnemonic at init time (address maps for both networks). */
export interface DerivedWallet {
  addresses: StoredKeystore["addresses"];
}

/** Derive the p2wpkh + p2tr address pair for one network via the SDK's `HDSigner`. */
function pairFor(
  mnemonic: string,
  network: "mainnet" | "testnet",
  opts: { account?: number; passphrase?: string },
): AddressPair {
  const a = HDSigner.fromMnemonic(mnemonic, { network, ...opts }).getAddresses();
  if (!a.p2tr) throw new CliError("Failed to derive a P2TR address", "DERIVE_FAILED");
  return { p2wpkh: a.p2wpkh, p2tr: a.p2tr };
}

/**
 * Derive the wallet's addresses from a mnemonic for BOTH SDK networks, following
 * the Horizon Wallet convention (BIP84 segwit + BIP86 taproot, `coin_type` per
 * network) via the SDK's `HDSigner` — no crypto is re-implemented here. Because
 * the coin-type differs by network, mainnet and testnet use different keys and
 * are derived independently.
 */
export function deriveWallet(
  mnemonic: string,
  opts: { account?: number; passphrase?: string } = {},
): DerivedWallet {
  return {
    addresses: {
      mainnet: pairFor(mnemonic, "mainnet", opts),
      testnet: pairFor(mnemonic, "testnet", opts),
    },
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
  signer: HDSigner;
  addresses: AddressPair;
  /** Derivation options to forward to `createClient` so the client's signer matches. */
  mnemonicOptions: { account: number; passphrase?: string };
}

/**
 * Decrypt the keystore's mnemonic with `password` (delegated to the SDK's
 * `decryptKeystore`) and rebuild the `HDSigner` for `sdkNetwork`. Verifies the
 * re-derived addresses match the ones stored at init — catching a wrong BIP39
 * passphrase (a wrong password already fails inside `decryptKeystore`).
 */
export async function unlockWallet(
  stored: StoredKeystore,
  password: string,
  sdkNetwork: "mainnet" | "testnet",
  passphrase: string | undefined,
): Promise<UnlockedWallet> {
  const mnemonic = await decryptKeystore(stored.keystore, password);
  const account = stored.account;
  const signer = HDSigner.fromMnemonic(mnemonic, {
    network: sdkNetwork,
    account,
    passphrase,
  });
  const addrs = signer.getAddresses();
  const expected = stored.addresses[sdkNetwork];
  if (addrs.p2wpkh !== expected.p2wpkh || addrs.p2tr !== expected.p2tr) {
    // The re-derived addresses don't match the ones stored at init. Either a
    // BIP39 passphrase is missing, or a wrong/extra one is being applied — check
    // the --passphrase flag / $HORIZON_PASSPHRASE against how the wallet was created.
    throw new CliError(
      "Re-derived addresses do not match the stored wallet — check your BIP39 passphrase (--passphrase / $HORIZON_PASSPHRASE).",
      "DERIVATION_MISMATCH",
    );
  }
  if (!addrs.p2tr) throw new CliError("Failed to derive a P2TR address", "DERIVE_FAILED");
  return {
    mnemonic,
    signer,
    addresses: { p2wpkh: addrs.p2wpkh, p2tr: addrs.p2tr },
    mnemonicOptions: passphrase ? { account, passphrase } : { account },
  };
}
