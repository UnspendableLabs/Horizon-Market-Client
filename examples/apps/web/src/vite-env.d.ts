/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Network selected on first load: "mainnet" | "signet". */
  readonly VITE_DEFAULT_NETWORK?: string;

  // ── Web3Auth (shared across networks) ──────────────────────
  readonly VITE_WEB3AUTH_CLIENT_ID: string;
  readonly VITE_WEB3AUTH_NETWORK?: string;

  // ── Mainnet ────────────────────────────────────────────────
  readonly VITE_HORIZON_MARKET_URL?: string;
  /** Ord API base URL — ordinals only load in the Sell form when this is set. */
  readonly VITE_ORD_API_URL?: string;
  /** Counterparty API v2 base URL — blank falls back to the SDK public default. */
  readonly VITE_COUNTERPARTY_API_URL?: string;
  /** ZeldHash API base URL — blank falls back to the SDK public default. */
  readonly VITE_ZELD_API_URL?: string;
  /** Kontor indexer URL (mainnet; Kontor is signet-only today — reserved). */
  readonly VITE_KONTOR_INDEXER_URL?: string;
  /** Kontor NFT contract address (mainnet; reserved for future support). */
  readonly VITE_KONTOR_NFT_CONTRACT?: string;

  // ── Signet (twins of the mainnet vars) ─────────────────────
  readonly VITE_HORIZON_MARKET_URL_SIGNET?: string;
  /** Ord API base URL (signet) — ordinals only load when this is set. */
  readonly VITE_ORD_API_URL_SIGNET?: string;
  /** Counterparty API v2 base URL (signet). */
  readonly VITE_COUNTERPARTY_API_URL_SIGNET?: string;
  /** ZeldHash API base URL (signet). */
  readonly VITE_ZELD_API_URL_SIGNET?: string;
  /** Kontor indexer URL (signet) — defaults to the public signet indexer. */
  readonly VITE_KONTOR_INDEXER_URL_SIGNET?: string;
  /** Kontor NFT contract address (signet) — enables owned-NFT enumeration. */
  readonly VITE_KONTOR_NFT_CONTRACT_SIGNET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
