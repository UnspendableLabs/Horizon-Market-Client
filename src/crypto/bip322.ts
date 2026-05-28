import { Signer as Bip322Signer } from "bip322-js";
import * as btc from "bitcoinjs-lib";
import { ECPair } from "./ecc.js";

/**
 * Sign a message using BIP322 (used for delist confirmation).
 *
 * NOTE: This uses BIP322, NOT BIP137. The server verifies with
 * `Verifier.verifySignature(address, message, signature)` from bip322-js.
 *
 * bip322-js Signer.sign expects WIF-encoded private keys; this function
 * accepts raw hex (with or without "0x" prefix) and converts automatically.
 *
 * @param privateKeyHex - Private key as hex string (with or without "0x" prefix)
 * @param address - Bitcoin address to sign as (P2WPKH or P2TR)
 * @param message - Message to sign (delist request id)
 * @returns Base64-encoded BIP322 signature
 */
export function signBip322(
  privateKeyHex: string,
  address: string,
  message: string,
): string {
  const hexKey = privateKeyHex.startsWith("0x")
    ? privateKeyHex.slice(2)
    : privateKeyHex;

  const privateKeyBuffer = Buffer.from(hexKey, "hex");
  try {
    // bip322-js infers the network from the address, so we use mainnet by default
    // but need to pick the right network for WIF encoding.
    // We derive WIF for bitcoin mainnet if address starts with bc1/1/3,
    // testnet otherwise.
    const isTestnet =
      address.startsWith("tb1") ||
      address.startsWith("m") ||
      address.startsWith("n") ||
      address.startsWith("2");

    const network = isTestnet ? btc.networks.testnet : btc.networks.bitcoin;
    const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });
    const wif = keyPair.toWIF();

    return Bip322Signer.sign(wif, address, message);
  } finally {
    privateKeyBuffer.fill(0);
  }
}
