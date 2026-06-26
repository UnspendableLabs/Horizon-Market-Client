import { LocalKey } from "@kontor/sdk";
import * as btc from "bitcoinjs-lib";
import { ECPair } from "./ecc.js";
import { signPsbtHex as signPsbtHexImpl } from "./psbt-signer.js";
import { signBip322 } from "./bip322.js";

export interface Signer {
  getAddresses(): {
    p2wpkh: string;
    p2tr?: string;
    publicKey: string;
    xOnlyPubkey?: string;
  };
  signPsbtHex(psbtHex: string, inputIndices: number[]): string;
  signMessage(address: string, message: string): string;
  /**
   * Optional: produce a Kontor SDK `Signing` for the given `@kontor/sdk` Chain.
   * Implemented by {@link LocalSigner} (reuses its in-memory private key via
   * `LocalKey.fromPrivateKey` — the key never leaves the client). Custom signers
   * that don't implement this cannot perform Kontor operations.
   *
   * Typed `unknown` so this interface stays free of a hard `@kontor/sdk` import;
   * the Kontor modules cast to the real `Chain`/`Signing` types at the boundary.
   */
  getKontorSigning?(chain: unknown): Promise<unknown>;
}

/**
 * Local signer that derives addresses and signs PSBTs/messages from a raw private key.
 *
 * WARNING: Keep your private key secure. Never share it or expose it in logs.
 */
export class LocalSigner implements Signer {
  private readonly privateKeyHex: string;
  private readonly network: btc.Network;

  constructor(
    privateKey: string | Uint8Array,
    network: "mainnet" | "testnet" = "mainnet",
  ) {
    if (typeof privateKey === "string") {
      this.privateKeyHex = privateKey.startsWith("0x")
        ? privateKey.slice(2)
        : privateKey;
    } else {
      this.privateKeyHex = Buffer.from(privateKey).toString("hex");
    }

    this.network =
      network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
  }

  getAddresses(): {
    p2wpkh: string;
    p2tr?: string;
    publicKey: string;
    xOnlyPubkey?: string;
  } {
    const privateKeyBuffer = Buffer.from(this.privateKeyHex, "hex");
    try {
      const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, {
        network: this.network,
      });

      const { address: p2wpkhAddress } = btc.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: this.network,
      });

      if (!p2wpkhAddress) {
        throw new Error("Failed to derive P2WPKH address");
      }

      const xOnlyPubkeyBytes = keyPair.publicKey.subarray(1, 33);
      const { address: p2trAddress } = btc.payments.p2tr({
        internalPubkey: xOnlyPubkeyBytes,
        network: this.network,
      });

      return {
        p2wpkh: p2wpkhAddress,
        p2tr: p2trAddress ?? undefined,
        publicKey: keyPair.publicKey.toString("hex"),
        xOnlyPubkey: Buffer.from(xOnlyPubkeyBytes).toString("hex"),
      };
    } finally {
      privateKeyBuffer.fill(0);
    }
  }

  signPsbtHex(psbtHex: string, inputIndices: number[]): string {
    return signPsbtHexImpl(
      psbtHex,
      inputIndices,
      this.privateKeyHex,
      this.network,
    );
  }

  signMessage(address: string, message: string): string {
    return signBip322(this.privateKeyHex, address, message);
  }

  /**
   * Build a Kontor SDK `Signing` from this signer's in-memory private key.
   *
   * The key is handed straight to `LocalKey.fromPrivateKey` and never serialized,
   * logged, or sent over the network — the Kontor SDK signs transactions locally
   * and only broadcasts the signed result. `chain` is a `@kontor/sdk` `Chain`.
   */
  async getKontorSigning(chain: unknown): Promise<unknown> {
    return LocalKey.fromPrivateKey({
      privateKey: this.privateKeyHex,
      chain: chain as never,
    });
  }
}
