import type { Signer } from "./crypto/signer.js";

export const DEFAULT_BASE_URL = "https://horizon.market";

/** Public Kontor signet indexer — the default transport target for Node consumers. */
export const DEFAULT_KONTOR_INDEXER_URL =
  "https://signet.kontor.network:35001/api";

/** Public mainnet Counterparty API v2 base URL (used to read owned balances). */
export const DEFAULT_COUNTERPARTY_API_BASE_URL =
  "https://api.counterparty.io:4000";

/** Public ZeldHash API base URL (ZELD is its own protocol, mainnet only). */
export const DEFAULT_ZELD_API_BASE_URL = "https://api.zeldhash.com";

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
   * Reuse an existing NextAuth session-token across processes (skips
   * `signInWithWallet`). Stored under the origin-correct cookie name
   * (`__Secure-authjs.session-token` for an HTTPS `baseUrl`, `authjs.session-token`
   * otherwise) and attached to fee-related requests so the server waives the
   * platform fee (credits / subscription).
   */
  sessionToken?: string;
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
  /**
   * Counterparty API v2 base URL for reading the connected wallet's owned XCP +
   * Counterparty asset balances. Defaults to `https://api.counterparty.io:4000`.
   * Mainnet only — `getCounterpartyBalances` returns `[]` on non-mainnet.
   */
  counterpartyApiBaseUrl?: string;
  /**
   * ZeldHash API base URL for reading the connected wallet's ZELD balance. ZELD
   * is its own protocol (not a Counterparty asset) and mainnet only. Defaults to
   * `https://api.zeldhash.com`.
   */
  zeldApiBaseUrl?: string;
  /**
   * Kontor NFT contract address (`name@height.txIndex`) used to enumerate the
   * connected wallet's owned NFTs. There is no cross-contract "all NFTs owned"
   * query in `@kontor/sdk` — ownership is per-contract — so without this, owned
   * NFTs are not listed (KOR token balance still works).
   */
  kontorNftContractAddress?: string;
}
