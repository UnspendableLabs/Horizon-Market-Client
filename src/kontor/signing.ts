import type { Chain, Signing } from "@kontor/sdk";
import type { Signer } from "../crypto/signer.js";
import { createWalletKontorSigning } from "./wallet-signing.js";

/**
 * Obtain a Kontor SDK `Signing` from a client Signer.
 *
 * Two paths, tried in order:
 *  1. **Key-holding signers** ({@link LocalSigner} / {@link HDSigner}) implement
 *     the optional `getKontorSigning` capability — they build a `LocalKey` from
 *     their in-process key, which never leaves the signer.
 *  2. **External wallets** (browser extension / mobile wallet connected via
 *     `initializeWithSigner`) don't hold a key and can't implement
 *     `getKontorSigning`, but they DO sign PSBTs asynchronously. When the signer
 *     exposes a Taproot address + its x-only public key, we build a wallet-backed
 *     `Signing` via {@link createWalletKontorSigning}, which delegates signing to
 *     the wallet's `signPsbtHex` / `signMessage`.
 *
 * Throws a clear error when neither path applies (no `getKontorSigning`, and no
 * taproot identity to sign a wallet `Signing` for).
 */
export async function getKontorSigning(
  signer: Signer,
  chain: Chain,
): Promise<Signing> {
  if (typeof signer.getKontorSigning === "function") {
    return (await signer.getKontorSigning(chain)) as Signing;
  }

  const addresses = signer.getAddresses();
  if (addresses.p2tr && addresses.xOnlyPubkey) {
    return createWalletKontorSigning(signer, chain);
  }

  throw new Error(
    "Kontor operations require either a signer that implements getKontorSigning() " +
      "(LocalSigner / HDSigner, built from { privateKey } or { mnemonic }), or an " +
      "external wallet signer that exposes a Taproot address and its x-only public " +
      "key via getAddresses() (p2tr + xOnlyPubkey).",
  );
}
