import type { Signer } from "./crypto/signer.js";

export const DEFAULT_BASE_URL = "https://horizon.market";

/**
 * Public Kontor signet indexer — the default transport target for Node consumers.
 * Port `35100` is the live `kontor-network` cluster running the current
 * `holder-ref` `token` contract (matching `@kontor/sdk`). The older `:35001`
 * endpoint is the pre-`holder-ref` `string`-contract staging deployment, whose
 * views fail with `invalid value type` — do not use it.
 */
export const DEFAULT_KONTOR_INDEXER_URL =
  "https://signet.kontor.network:35100/api";

/** Public mainnet Counterparty API v2 base URL (used to read owned balances). */
export const DEFAULT_COUNTERPARTY_API_BASE_URL =
  "https://api.counterparty.io:4000";

/** Public ZeldHash API base URL (ZELD is its own protocol, mainnet only). */
export const DEFAULT_ZELD_API_BASE_URL = "https://api.zeldhash.com";

export interface HorizonMarketClientOptions {
  /**
   * Private key as hex string (with or without "0x") or raw bytes. Uses the
   * legacy single-key `LocalSigner` (one key backs both p2wpkh + p2tr). For the
   * Horizon Wallet convention (web3auth apps + CLI), pass a `mnemonic`, or a
   * `signer: HDSigner.fromPrivateKey(key, { network })`. Omit when providing `signer`.
   */
  privateKey?: string | Uint8Array;
  /**
   * BIP39 mnemonic. Derived to Horizon-Wallet-compatible keys — a BIP84 key for
   * the p2wpkh (SegWit) address and a BIP86 key for the p2tr (Taproot) address,
   * with `coin_type` per network — via `HDSigner.fromMnemonic`.
   * Precedence: `signer` > `privateKey` > `mnemonic`.
   */
  mnemonic?: string;
  /** Derivation overrides for `mnemonic` (BIP32 `account` index, BIP39 `passphrase`). */
  mnemonicOptions?: { account?: number; passphrase?: string };
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
   * Reuse a bearer session token (from `signInWithWallet`) across client
   * re-creations. Attached as `Authorization: Bearer <token>`, which — unlike the
   * cookie jar — works in cross-origin browser apps. Prefer this over
   * `sessionToken` for web clients.
   */
  bearerToken?: string;
  /**
   * Enables Kontor (KOR token + NFT) operations. Only "signet" is supported by
   * `@kontor/sdk` today. When set, the client `network` must be "testnet" (signet
   * shares testnet address params). Required for any `listingType: "kontor"` op.
   */
  kontorNetwork?: "signet";
  /**
   * Kontor indexer URL the SDK transport submits signed transactions to. Defaults
   * to the public signet indexer (`https://signet.kontor.network:35100/api`), so
   * Node consumers broadcast directly without proxying through Horizon. Browser
   * consumers can point this at `${baseUrl}/api/kontor-indexer` to avoid CORS.
   */
  kontorIndexerUrl?: string;
  /**
   * Counterparty API v2 base URL for reading the connected wallet's owned XCP +
   * Counterparty asset balances. Defaults to `https://api.counterparty.io:4000`
   * on mainnet. On other networks it's used only when set (so balances aren't
   * read against the wrong network); unset → `getCounterpartyBalances` returns `[]`.
   */
  counterpartyApiBaseUrl?: string;
  /**
   * ZeldHash API base URL for reading the connected wallet's ZELD balance. ZELD
   * is its own protocol (not a Counterparty asset). Defaults to
   * `https://api.zeldhash.com` on mainnet. On other networks it's used only when
   * set; unset → `getZeldBalances` returns `[]`.
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
