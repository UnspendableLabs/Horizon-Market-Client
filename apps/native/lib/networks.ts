/**
 * Single source of truth mapping a UI network → <HorizonMarketProvider> props.
 * Mirror of the web app's src/lib/networks.ts, adapted to React Native:
 *   - reads process.env.EXPO_PUBLIC_* (inlined by Expo at build time)
 *   - persistence is async (AsyncStorage) instead of localStorage
 *
 * "Signet" is not a distinct SDK network: it maps to `network="testnet"`
 * (signet shares testnet address params) + `kontorNetwork="signet"`. The SDK is
 * unchanged — the UI just says "Signet" and supplies these props.
 *
 * Web3Auth env vars are SHARED across networks (one login → one key → derive
 * both networks' addresses); only network-specific vars get a `_SIGNET` twin.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

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
 * overridable per-network via the EXPO_PUBLIC_* / *_SIGNET vars. `baseUrl`
 * (Horizon Market API) defaults per network too: the SDK's own default is the
 * mainnet origin, so signet MUST set its own here or it would read mainnet data.
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
    // The live signet consensus cluster (k8s `kontor-network`, port 35100),
    // which runs the current `holder-ref` `token` contract matching @kontor/sdk.
    // We DELIBERATELY override the SDK default (`:35001/api`): that port is the
    // old `kontor-staging` deployment, still on the pre-holder-ref `string`
    // contract, so views fail with `invalid value type`. Confirmed via the GKE
    // Gateway: external :35100 → kontor-network-service (holder-ref).
    kontorIndexerUrl: "https://signet.kontor.network:35100/api",
  },
} as const;

export const NETWORKS: Record<UiNetwork, NetworkConfig> = {
  mainnet: {
    label: "Mainnet",
    sdkNetwork: "mainnet",
    baseUrl:
      clean(process.env.EXPO_PUBLIC_HORIZON_MARKET_URL) ??
      DEFAULTS.mainnet.baseUrl,
    ordApiBaseUrl:
      clean(process.env.EXPO_PUBLIC_ORD_API_URL) ??
      DEFAULTS.mainnet.ordApiBaseUrl,
    counterpartyApiBaseUrl:
      clean(process.env.EXPO_PUBLIC_COUNTERPARTY_API_URL) ??
      DEFAULTS.mainnet.counterpartyApiBaseUrl,
    zeldApiBaseUrl:
      clean(process.env.EXPO_PUBLIC_ZELD_API_URL) ??
      DEFAULTS.mainnet.zeldApiBaseUrl,
    // Kontor is signet-only in @kontor/sdk today; these are plumbed for when
    // mainnet support lands (ignored by the SDK while kontorNetwork is unset).
    kontorIndexerUrl: clean(process.env.EXPO_PUBLIC_KONTOR_INDEXER_URL),
    kontorNftContractAddress: clean(process.env.EXPO_PUBLIC_KONTOR_NFT_CONTRACT),
  },
  signet: {
    label: "Signet",
    sdkNetwork: "testnet",
    kontorNetwork: "signet",
    baseUrl:
      clean(process.env.EXPO_PUBLIC_HORIZON_MARKET_URL_SIGNET) ??
      DEFAULTS.signet.baseUrl,
    ordApiBaseUrl:
      clean(process.env.EXPO_PUBLIC_ORD_API_URL_SIGNET) ??
      DEFAULTS.signet.ordApiBaseUrl,
    counterpartyApiBaseUrl:
      clean(process.env.EXPO_PUBLIC_COUNTERPARTY_API_URL_SIGNET) ??
      DEFAULTS.signet.counterpartyApiBaseUrl,
    // ZELD signet has no default yet (API not live); set its URL to enable.
    zeldApiBaseUrl: clean(process.env.EXPO_PUBLIC_ZELD_API_URL_SIGNET),
    // Unset → the live signet cluster on `:35100/api` (see DEFAULTS.signet). A
    // browser build would override with `${baseUrl}/api/kontor-indexer` (CORS).
    kontorIndexerUrl:
      clean(process.env.EXPO_PUBLIC_KONTOR_INDEXER_URL_SIGNET) ??
      DEFAULTS.signet.kontorIndexerUrl,
    kontorNftContractAddress: clean(
      process.env.EXPO_PUBLIC_KONTOR_NFT_CONTRACT_SIGNET,
    ),
  },
};

const STORAGE_KEY = "horizon.network";

function isUiNetwork(v: string | null | undefined): v is UiNetwork {
  return v === "mainnet" || v === "signet";
}

/**
 * Synchronous initial network from EXPO_PUBLIC_DEFAULT_NETWORK → "mainnet".
 * AsyncStorage can't be read synchronously, so the persisted choice is loaded
 * separately via {@link loadPersistedNetwork} and applied on mount.
 */
export function getInitialNetwork(): UiNetwork {
  const fromEnv = process.env.EXPO_PUBLIC_DEFAULT_NETWORK;
  if (isUiNetwork(fromEnv)) return fromEnv;
  return "mainnet";
}

/** Read the persisted network choice, or null if none / unavailable. */
export async function loadPersistedNetwork(): Promise<UiNetwork | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return isUiNetwork(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persist the user's network choice so it survives an app relaunch. */
export async function persistNetwork(network: UiNetwork): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, network);
  } catch {
    // Best-effort — ignore storage failures.
  }
}
