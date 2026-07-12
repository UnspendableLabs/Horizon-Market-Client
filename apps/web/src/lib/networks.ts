/**
 * Single source of truth mapping a UI network → <HorizonMarketProvider> props.
 *
 * "Signet" is not a distinct SDK network: it maps to `network="testnet"`
 * (signet shares testnet address params) + `kontorNetwork="signet"` (activates
 * Kontor; the default Kontor indexer is already signet). The SDK is unchanged —
 * the UI just says "Signet" and supplies these props.
 *
 * Web3Auth env vars are SHARED across networks (one login → one key → derive
 * both networks' addresses); only network-specific vars get a `_SIGNET` twin.
 */

export type UiNetwork = "mainnet" | "signet";

/** Props spread directly into <HorizonMarketProvider>. */
export interface NetworkConfig {
  label: string;
  sdkNetwork: "mainnet" | "testnet";
  kontorNetwork?: "signet";
  baseUrl?: string;
  ordApiBaseUrl?: string;
  counterpartyApiBaseUrl?: string;
  zeldApiBaseUrl?: string;
  kontorIndexerUrl?: string;
  kontorNftContractAddress?: string;
}

/** Treat empty / whitespace-only env values as "unset" so we never override an
 *  SDK default with an empty string. */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Example default API endpoints — applied when the matching env var is unset,
 * overridable per-network via the VITE_* / *_SIGNET vars. `baseUrl` (Horizon
 * Market API) defaults per network too: the SDK's own default is the mainnet
 * origin, so signet MUST set its own here or it would read mainnet data.
 */
const DEFAULTS = {
  mainnet: {
    baseUrl: "https://horizon.market",
    ordApiBaseUrl: "https://api.counterparty.io:7000",
    counterpartyApiBaseUrl: "https://api.counterparty.io:4000",
    zeldApiBaseUrl: "https://api.zeldhash.com",
  },
  signet: {
    baseUrl: "https://signet.horizon.market",
    ordApiBaseUrl: "https://signet.counterparty.io:37000",
    counterpartyApiBaseUrl: "https://signet.counterparty.io:34000",
    kontorIndexerUrl: "https://signet.kontor.network:35100",
  },
} as const;

export const NETWORKS: Record<UiNetwork, NetworkConfig> = {
  mainnet: {
    label: "Mainnet",
    sdkNetwork: "mainnet",
    baseUrl:
      clean(import.meta.env.VITE_HORIZON_MARKET_URL) ?? DEFAULTS.mainnet.baseUrl,
    ordApiBaseUrl:
      clean(import.meta.env.VITE_ORD_API_URL) ?? DEFAULTS.mainnet.ordApiBaseUrl,
    counterpartyApiBaseUrl:
      clean(import.meta.env.VITE_COUNTERPARTY_API_URL) ??
      DEFAULTS.mainnet.counterpartyApiBaseUrl,
    zeldApiBaseUrl:
      clean(import.meta.env.VITE_ZELD_API_URL) ??
      DEFAULTS.mainnet.zeldApiBaseUrl,
    // Kontor is signet-only in @kontor/sdk today; these are plumbed for when
    // mainnet support lands (ignored by the SDK while kontorNetwork is unset).
    kontorIndexerUrl: clean(import.meta.env.VITE_KONTOR_INDEXER_URL),
    kontorNftContractAddress: clean(import.meta.env.VITE_KONTOR_NFT_CONTRACT),
  },
  signet: {
    label: "Signet",
    sdkNetwork: "testnet",
    kontorNetwork: "signet",
    baseUrl:
      clean(import.meta.env.VITE_HORIZON_MARKET_URL_SIGNET) ??
      DEFAULTS.signet.baseUrl,
    ordApiBaseUrl:
      clean(import.meta.env.VITE_ORD_API_URL_SIGNET) ??
      DEFAULTS.signet.ordApiBaseUrl,
    counterpartyApiBaseUrl:
      clean(import.meta.env.VITE_COUNTERPARTY_API_URL_SIGNET) ??
      DEFAULTS.signet.counterpartyApiBaseUrl,
    // ZELD signet has no default yet (API not live); set its URL to enable.
    zeldApiBaseUrl: clean(import.meta.env.VITE_ZELD_API_URL_SIGNET),
    // Override with `${baseUrl}/api/kontor-indexer` to avoid browser CORS.
    kontorIndexerUrl:
      clean(import.meta.env.VITE_KONTOR_INDEXER_URL_SIGNET) ??
      DEFAULTS.signet.kontorIndexerUrl,
    kontorNftContractAddress: clean(import.meta.env.VITE_KONTOR_NFT_CONTRACT_SIGNET),
  },
};

const STORAGE_KEY = "horizon.network";

function isUiNetwork(v: string | null | undefined): v is UiNetwork {
  return v === "mainnet" || v === "signet";
}

/**
 * Resolve the initial network: persisted choice (localStorage) →
 * VITE_DEFAULT_NETWORK → "mainnet".
 */
export function getInitialNetwork(): UiNetwork {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isUiNetwork(stored)) return stored;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }
  const fromEnv = import.meta.env.VITE_DEFAULT_NETWORK;
  if (isUiNetwork(fromEnv)) return fromEnv;
  return "mainnet";
}

/** Persist the user's network choice so it survives a reload. */
export function persistNetwork(network: UiNetwork): void {
  try {
    localStorage.setItem(STORAGE_KEY, network);
  } catch {
    // Best-effort — ignore storage failures.
  }
}
