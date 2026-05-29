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
  ordApiBaseUrl: string | undefined;
  fetch: typeof globalThis.fetch;
  theme: ResolvedTheme;
}

const HorizonMarketContext = createContext<HorizonMarketContextValue | null>(
  null,
);

export interface HorizonMarketProviderProps {
  network?: Network;
  baseUrl?: string;
  ordApiBaseUrl?: string;
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
  ordApiBaseUrl,
  fetch: fetchImpl,
  theme,
  children,
}: HorizonMarketProviderProps) {
  const [authState, setAuthState] = useState<AuthState | null>(null);

  const anonClient = useMemo(
    () => new HorizonMarketClient({ network, baseUrl, fetch: fetchImpl }),
    [network, baseUrl, fetchImpl],
  );

  const authedClient = useMemo(
    () =>
      authState
        ? new HorizonMarketClient({
            signer: authState.signer,
            network,
            baseUrl,
            fetch: fetchImpl,
          })
        : null,
    [authState, network, baseUrl, fetchImpl],
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
      ordApiBaseUrl,
      fetch: resolvedFetch,
      theme: resolvedTheme,
    }),
    [authedClient, anonClient, authState, initialize, logout, network, ordApiBaseUrl, resolvedFetch, resolvedTheme],
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
