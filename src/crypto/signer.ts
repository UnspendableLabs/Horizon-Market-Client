import * as btc from "bitcoinjs-lib";
import { ECPair } from "./ecc.js";
import {
  signPsbtHex as signPsbtHexImpl,
  signPsbtHexWithKeys,
} from "./psbt-signer.js";
import { signBip322 } from "./bip322.js";
import {
  mnemonicToPrivateKey,
  privateKeyToMnemonic,
  deriveHorizonWalletKeys,
  type HorizonWalletDeriveOptions,
} from "./mnemonic.js";
import { assertKontorRuntime, KontorUnavailableError } from "../kontor/runtime.js";

/**
 * Lazily load `@kontor/sdk`'s `LocalKey`, keeping the Kontor backend out of the
 * app-startup graph. Enforces the graceful-degrade contract AT THE IMPORT SITE:
 * asserts a backend can load, then maps any dynamic-import failure — e.g. a React
 * Native build where the runtime guard optimistically passed but `@kontor/sdk-native`
 * was never linked — to the documented {@link KontorUnavailableError} instead of a
 * raw module-load error. Shared by every `getKontorSigning` so the guarantee can't
 * regress in one signer.
 */
async function loadKontorLocalKey() {
  assertKontorRuntime();
  try {
    const { LocalKey } = await import("@kontor/sdk");
    return LocalKey;
  } catch (cause) {
    throw new KontorUnavailableError(undefined, { cause });
  }
}

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

  /**
   * Build a {@link LocalSigner} from a BIP39 mnemonic.
   *
   * Derives a single secp256k1 key at `path` (default BIP86
   * `m/86'/0'/0'/0/0`) and — as with a raw private key — exposes BOTH the
   * p2wpkh and p2tr address from it (`getAddresses()`), matching the example
   * apps' single-key wallet model.
   */
  static fromMnemonic(
    mnemonic: string,
    opts: {
      network?: "mainnet" | "testnet";
      path?: string;
      passphrase?: string;
    } = {},
  ): LocalSigner {
    const privateKey = mnemonicToPrivateKey(mnemonic, {
      path: opts.path,
      passphrase: opts.passphrase,
    });
    return new LocalSigner(privateKey, opts.network ?? "mainnet");
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
    // `@kontor/sdk` evaluates its backend at import time (a WASM component on
    // web/Node, a native JSI crate on React Native) — load it lazily, and only
    // when a Kontor operation actually runs, so nothing evaluates at startup. The
    // helper fails fast (KontorUnavailableError) where no backend can load.
    const LocalKey = await loadKontorLocalKey();
    return LocalKey.fromPrivateKey({
      privateKey: this.privateKeyHex,
      chain: chain as never,
    });
  }
}

/**
 * HD signer matching the Horizon Wallet browser extension's derivation exactly:
 * a **BIP84** key (`m/84'/<coin>'/<account>'/0/0`) backs the p2wpkh (SegWit)
 * address and a **BIP86** key (`m/86'/<coin>'/<account>'/0/0`) backs the p2tr
 * (Taproot) address, with `coin_type` chosen from the network. This differs from
 * {@link LocalSigner}, which uses one key for both — the single-key model is
 * intrinsic to web3auth (a raw key with no seed) and cannot reproduce a standard
 * BIP84/BIP86 wallet's addresses.
 *
 * Signing routes per input: SegWit inputs are signed with the BIP84 key, Taproot
 * inputs with the BIP86 key; Kontor/KOR (Taproot-only) use the BIP86 key.
 *
 * WARNING: Keep the derived keys secure. Never share them or expose them in logs.
 */
export class HDSigner implements Signer {
  private readonly segwitKeyHex: string;
  private readonly taprootKeyHex: string;
  private readonly network: btc.Network;

  constructor(
    keys: { segwitKeyHex: string; taprootKeyHex: string },
    network: "mainnet" | "testnet" = "mainnet",
  ) {
    const strip = (k: string) => (k.startsWith("0x") ? k.slice(2) : k);
    this.segwitKeyHex = strip(keys.segwitKeyHex);
    this.taprootKeyHex = strip(keys.taprootKeyHex);
    this.network =
      network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
  }

  /**
   * Build an {@link HDSigner} from a BIP39 mnemonic using the Horizon Wallet
   * derivation convention (see {@link deriveHorizonWalletKeys}).
   */
  static fromMnemonic(
    mnemonic: string,
    opts: HorizonWalletDeriveOptions = {},
  ): HDSigner {
    const { segwit, taproot } = deriveHorizonWalletKeys(mnemonic, opts);
    return new HDSigner(
      { segwitKeyHex: segwit.privateKeyHex, taprootKeyHex: taproot.privateKeyHex },
      opts.network ?? "mainnet",
    );
  }

  /**
   * Build an {@link HDSigner} from a raw 32-byte private key (e.g. a web3auth
   * social-login key) by first encoding it as a BIP39 mnemonic via
   * {@link privateKeyToMnemonic}, then deriving the Horizon Wallet keys. This is
   * the canonical web3auth → Horizon Wallet bridge: it is exactly equivalent to
   * `HDSigner.fromMnemonic(privateKeyToMnemonic(privateKey, { words }), opts)`,
   * so a web/native app connecting with a web3auth key and a wallet importing
   * that same exported mnemonic derive the SAME p2wpkh + p2tr addresses.
   *
   * `opts.words` selects the phrase length (default 24). Use `12` to match the
   * Horizon Wallet extension (12-word-only import); the two lengths encode
   * DIFFERENT wallets — see {@link privateKeyToMnemonic}.
   *
   * NOTE: the resulting keys come from the mnemonic's BIP39 seed, NOT from the
   * raw key directly — so these addresses differ from the legacy single-key
   * {@link LocalSigner} addresses for the same key.
   */
  static fromPrivateKey(
    privateKey: string | Uint8Array,
    opts: HorizonWalletDeriveOptions & { words?: 12 | 24 } = {},
  ): HDSigner {
    return HDSigner.fromMnemonic(
      privateKeyToMnemonic(privateKey, { words: opts.words }),
      opts,
    );
  }

  getAddresses(): {
    p2wpkh: string;
    p2tr?: string;
    publicKey: string;
    xOnlyPubkey?: string;
  } {
    const segwitBuf = Buffer.from(this.segwitKeyHex, "hex");
    const taprootBuf = Buffer.from(this.taprootKeyHex, "hex");
    try {
      const segwitPair = ECPair.fromPrivateKey(segwitBuf, {
        network: this.network,
      });
      const taprootPair = ECPair.fromPrivateKey(taprootBuf, {
        network: this.network,
      });

      const { address: p2wpkhAddress } = btc.payments.p2wpkh({
        pubkey: segwitPair.publicKey,
        network: this.network,
      });
      if (!p2wpkhAddress) {
        throw new Error("Failed to derive P2WPKH address");
      }

      const xOnlyPubkeyBytes = taprootPair.publicKey.subarray(1, 33);
      const { address: p2trAddress } = btc.payments.p2tr({
        internalPubkey: xOnlyPubkeyBytes,
        network: this.network,
      });

      return {
        p2wpkh: p2wpkhAddress,
        p2tr: p2trAddress ?? undefined,
        publicKey: segwitPair.publicKey.toString("hex"),
        xOnlyPubkey: Buffer.from(xOnlyPubkeyBytes).toString("hex"),
      };
    } finally {
      segwitBuf.fill(0);
      taprootBuf.fill(0);
    }
  }

  signPsbtHex(psbtHex: string, inputIndices: number[]): string {
    return signPsbtHexWithKeys(
      psbtHex,
      inputIndices,
      { ecdsaKeyHex: this.segwitKeyHex, taprootKeyHex: this.taprootKeyHex },
      this.network,
    );
  }

  signMessage(address: string, message: string): string {
    // Pick the key whose address is being signed as: the Taproot (BIP86) key for
    // our p2tr address, the SegWit (BIP84) key otherwise (p2wpkh / default).
    const addrs = this.getAddresses();
    const keyHex =
      addrs.p2tr && address === addrs.p2tr
        ? this.taprootKeyHex
        : this.segwitKeyHex;
    return signBip322(keyHex, address, message);
  }

  /**
   * Build a Kontor SDK `Signing` from the Taproot (BIP86) key — Kontor/KOR assets
   * are routed to the Taproot address, so its key is the one Kontor signs with.
   * The key is handed to `LocalKey.fromPrivateKey` and never serialized or logged.
   */
  async getKontorSigning(chain: unknown): Promise<unknown> {
    const LocalKey = await loadKontorLocalKey();
    return LocalKey.fromPrivateKey({
      privateKey: this.taprootKeyHex,
      chain: chain as never,
    });
  }
}
