import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { resolveFetch } from "../api/resolveFetch.js";
import { HorizonMarketClient } from "../client.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { LocalSigner, type Signer } from "../crypto/signer.js";
import type { Network } from "../types/index.js";
import {
  resolveTheme,
  type HorizonMarketTheme,
  type ResolvedTheme,
} from "./theme.js";

export type Addresses = ReturnType<Signer["getAddresses"]>;

export interface HorizonMarketContextValue {
  client: HorizonMarketClient;
  addresses: Addresses | null;
  initialize: (privateKey: string | Uint8Array) => void;
  logout: () => void;
  network: Network;
  /** Set to `"signet"` when Kontor (KOR token + NFT) listings are enabled. */
  kontorNetwork: "signet" | undefined;
  /** Resolved Horizon Market API origin (e.g. for the asset-image endpoint). */
  baseUrl: string;
  ordApiBaseUrl: string | undefined;
  /** TTL (ms) for the persistent owned-balances cache. Defaults to 1h. */
  balancesCacheTtlMs: number | undefined;
  fetch: typeof globalThis.fetch;
  theme: ResolvedTheme;
}

const HorizonMarketContext = createContext<HorizonMarketContextValue | null>(
  null,
);

export interface HorizonMarketProviderProps {
  network?: Network;
  baseUrl?: string;
  /**
   * Enables Kontor (KOR token + NFT) listings. Only `"signet"` is supported.
   * When unset, the Kontor filter shows a "signet only" notice instead of
   * querying. Pair with `network="testnet"` (signet shares testnet params).
   */
  kontorNetwork?: "signet";
  /**
   * Kontor indexer URL the client reads from / submits signed transactions to.
   * Defaults to the public signet indexer. Browser apps can point this at
   * `${baseUrl}/api/kontor-indexer` to avoid CORS.
   */
  kontorIndexerUrl?: string;
  ordApiBaseUrl?: string;
  /** Counterparty API v2 base URL (owned balances). Defaults to the public API. */
  counterpartyApiBaseUrl?: string;
  /** ZeldHash API base URL (ZELD balance). Defaults to the public API. */
  zeldApiBaseUrl?: string;
  /** Kontor NFT contract address used to enumerate owned NFTs (signet). */
  kontorNftContractAddress?: string;
  /** TTL (ms) for the persistent owned-balances cache. Defaults to 1h. */
  balancesCacheTtlMs?: number;
  /** Custom fetch — forwarded to the client and used for ord API calls. */
  fetch?: typeof globalThis.fetch;
  theme?: HorizonMarketTheme;
  children: ReactNode;
}

interface AuthState {
  addresses: Addresses;
  signer: Signer;
}

export function HorizonMarketProvider({
  network = "mainnet",
  baseUrl,
  kontorNetwork,
  kontorIndexerUrl,
  ordApiBaseUrl,
  counterpartyApiBaseUrl,
  zeldApiBaseUrl,
  kontorNftContractAddress,
  balancesCacheTtlMs,
  fetch: fetchImpl,
  theme,
  children,
}: HorizonMarketProviderProps) {
  const [authState, setAuthState] = useState<AuthState | null>(null);

  const anonClient = useMemo(
    () =>
      new HorizonMarketClient({
        network,
        baseUrl,
        kontorNetwork,
        kontorIndexerUrl,
        counterpartyApiBaseUrl,
        zeldApiBaseUrl,
        kontorNftContractAddress,
        fetch: fetchImpl,
      }),
    [
      network,
      baseUrl,
      kontorNetwork,
      kontorIndexerUrl,
      counterpartyApiBaseUrl,
      zeldApiBaseUrl,
      kontorNftContractAddress,
      fetchImpl,
    ],
  );

  const authedClient = useMemo(
    () =>
      authState
        ? new HorizonMarketClient({
            signer: authState.signer,
            network,
            baseUrl,
            kontorNetwork,
            kontorIndexerUrl,
            counterpartyApiBaseUrl,
            zeldApiBaseUrl,
            kontorNftContractAddress,
            fetch: fetchImpl,
          })
        : null,
    [
      authState,
      network,
      baseUrl,
      kontorNetwork,
      kontorIndexerUrl,
      counterpartyApiBaseUrl,
      zeldApiBaseUrl,
      kontorNftContractAddress,
      fetchImpl,
    ],
  );

  const initialize = useCallback(
    (privateKey: string | Uint8Array) => {
      const signer = new LocalSigner(privateKey, network);
      const addresses = signer.getAddresses();
      setAuthState({ signer, addresses });
    },
    [network],
  );

  const logout = useCallback(() => {
    setAuthState(null);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  const resolvedFetch = useMemo(() => resolveFetch(fetchImpl), [fetchImpl]);

  const value = useMemo<HorizonMarketContextValue>(
    () => ({
      client: authedClient ?? anonClient,
      addresses: authState?.addresses ?? null,
      initialize,
      logout,
      network,
      kontorNetwork,
      baseUrl: baseUrl ?? DEFAULT_BASE_URL,
      ordApiBaseUrl,
      balancesCacheTtlMs,
      fetch: resolvedFetch,
      theme: resolvedTheme,
    }),
    [authedClient, anonClient, authState, initialize, logout, network, kontorNetwork, baseUrl, ordApiBaseUrl, balancesCacheTtlMs, resolvedFetch, resolvedTheme],
  );

  return (
    <HorizonMarketContext.Provider value={value}>
      {children}
    </HorizonMarketContext.Provider>
  );
}

export function useHorizonMarket(): HorizonMarketContextValue {
  const ctx = useContext(HorizonMarketContext);
  if (!ctx) {
    throw new Error(
      "useHorizonMarket must be used within a <HorizonMarketProvider>",
    );
  }
  return ctx;
}
