import type { Signer } from "./crypto/signer.js";

export const DEFAULT_BASE_URL = "https://horizon.market";

/** Public Kontor signet indexer — the default transport target for Node consumers. */
export const DEFAULT_KONTOR_INDEXER_URL =
  "https://signet.kontor.network:35001/api";

export interface HorizonMarketClientOptions {
  /** Private key as hex string (with or without "0x") or raw bytes. Omit when providing `signer`. */
  privateKey?: string | Uint8Array;
  /** Custom signer (hardware wallet, etc.). Takes precedence over `privateKey`. */
  signer?: Signer;
  /** Bitcoin network. Defaults to "mainnet". */
  network?: "mainnet" | "testnet";
  /** API origin. Defaults to "https://horizon.market". */
  baseUrl?: string;
  /** Injectable fetch for tests or custom runtimes. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Enables Kontor (KOR token + NFT) operations. Only "signet" is supported by
   * `@kontor/sdk` today. When set, the client `network` must be "testnet" (signet
   * shares testnet address params). Required for any `listingType: "kontor"` op.
   */
  kontorNetwork?: "signet";
  /**
   * Kontor indexer URL the SDK transport submits signed transactions to. Defaults
   * to the public signet indexer (`https://signet.kontor.network:35001/api`), so
   * Node consumers broadcast directly without proxying through Horizon. Browser
   * consumers can point this at `${baseUrl}/api/kontor-indexer` to avoid CORS.
   */
  kontorIndexerUrl?: string;
}
