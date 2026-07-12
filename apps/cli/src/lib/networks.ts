/**
 * Network table — the CLI mirror of `apps/web/src/lib/networks.ts`,
 * reading `process.env` (not Vite's `import.meta.env`). Maps a UI network to the
 * concrete `HorizonMarketClient` endpoints plus the CLI-only `ordApiBaseUrl`
 * (the ord server URL is consumed by `lib/ordinals.ts`, not the client).
 *
 * "Signet" is not a distinct SDK network: it maps to `sdkNetwork:"testnet"`
 * (signet shares testnet address params) + `kontorNetwork:"signet"`.
 */

export type UiNetwork = "mainnet" | "signet";

export interface NetworkConfig {
  label: string;
  uiNetwork: UiNetwork;
  sdkNetwork: "mainnet" | "testnet";
  kontorNetwork?: "signet";
  baseUrl: string;
  /** ord server base (CLI-side only — not a `HorizonMarketClientOptions` field). */
  ordApiBaseUrl?: string;
  counterpartyApiBaseUrl?: string;
  zeldApiBaseUrl?: string;
  kontorIndexerUrl?: string;
  kontorNftContractAddress?: string;
}

/** Treat empty / whitespace-only env values as "unset". */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

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

export function isUiNetwork(v: string | null | undefined): v is UiNetwork {
  return v === "mainnet" || v === "signet";
}

/** Resolve the endpoint table for a UI network (env overrides applied). */
export function getNetworkConfig(network: UiNetwork): NetworkConfig {
  const env = process.env;
  if (network === "signet") {
    return {
      label: "Signet",
      uiNetwork: "signet",
      sdkNetwork: "testnet",
      kontorNetwork: "signet",
      baseUrl: clean(env.HORIZON_MARKET_URL_SIGNET) ?? DEFAULTS.signet.baseUrl,
      ordApiBaseUrl:
        clean(env.HORIZON_ORD_API_URL_SIGNET) ?? DEFAULTS.signet.ordApiBaseUrl,
      counterpartyApiBaseUrl:
        clean(env.HORIZON_COUNTERPARTY_API_URL_SIGNET) ??
        DEFAULTS.signet.counterpartyApiBaseUrl,
      // ZELD signet has no default yet (API not live); set its URL to enable.
      zeldApiBaseUrl: clean(env.HORIZON_ZELD_API_URL_SIGNET),
      kontorIndexerUrl:
        clean(env.HORIZON_KONTOR_INDEXER_URL_SIGNET) ??
        DEFAULTS.signet.kontorIndexerUrl,
      kontorNftContractAddress: clean(env.HORIZON_KONTOR_NFT_CONTRACT_SIGNET),
    };
  }
  return {
    label: "Mainnet",
    uiNetwork: "mainnet",
    sdkNetwork: "mainnet",
    baseUrl: clean(env.HORIZON_MARKET_URL) ?? DEFAULTS.mainnet.baseUrl,
    ordApiBaseUrl:
      clean(env.HORIZON_ORD_API_URL) ?? DEFAULTS.mainnet.ordApiBaseUrl,
    counterpartyApiBaseUrl:
      clean(env.HORIZON_COUNTERPARTY_API_URL) ??
      DEFAULTS.mainnet.counterpartyApiBaseUrl,
    zeldApiBaseUrl:
      clean(env.HORIZON_ZELD_API_URL) ?? DEFAULTS.mainnet.zeldApiBaseUrl,
    // Kontor is signet-only in @kontor/sdk today; plumbed for later mainnet support.
    kontorIndexerUrl: clean(env.HORIZON_KONTOR_INDEXER_URL),
    kontorNftContractAddress: clean(env.HORIZON_KONTOR_NFT_CONTRACT),
  };
}

/** mempool.space REST API base for a network (no trailing slash). */
export function mempoolApiBase(cfg: NetworkConfig): string {
  if (cfg.sdkNetwork === "mainnet") return "https://mempool.space/api";
  return cfg.kontorNetwork === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/testnet/api";
}

/** mempool.space transaction explorer URL for a network, or null without a txid. */
export function mempoolTxUrl(
  cfg: NetworkConfig,
  txid: string | null | undefined,
): string | null {
  if (!txid) return null;
  const base =
    cfg.sdkNetwork === "mainnet"
      ? "https://mempool.space"
      : cfg.kontorNetwork === "signet"
        ? "https://mempool.space/signet"
        : "https://mempool.space/testnet";
  return `${base}/tx/${txid}`;
}
