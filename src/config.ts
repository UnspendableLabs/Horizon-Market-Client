import type { Signer } from "./crypto/signer.js";

export const DEFAULT_BASE_URL = "https://horizon.market";

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
}
