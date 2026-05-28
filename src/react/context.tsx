import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
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
  client: HorizonMarketClient | null;
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

interface ClientState {
  client: HorizonMarketClient;
  addresses: Addresses;
}

export function HorizonMarketProvider({
  network = "mainnet",
  baseUrl,
  ordApiBaseUrl,
  fetch: fetchImpl,
  theme,
  children,
}: HorizonMarketProviderProps) {
  const [state, setState] = useState<ClientState | null>(null);

  const initialize = useCallback(
    (privateKey: string | Uint8Array) => {
      const signer = new LocalSigner(privateKey, network);
      const addresses = signer.getAddresses();
      const client = new HorizonMarketClient({
        signer,
        network,
        baseUrl,
        fetch: fetchImpl,
      });
      setState({ client, addresses });
    },
    [network, baseUrl, fetchImpl],
  );

  const logout = useCallback(() => {
    setState(null);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  const resolvedFetch = fetchImpl ?? globalThis.fetch;

  const value = useMemo<HorizonMarketContextValue>(
    () => ({
      client: state?.client ?? null,
      addresses: state?.addresses ?? null,
      initialize,
      logout,
      network,
      ordApiBaseUrl,
      fetch: resolvedFetch,
      theme: resolvedTheme,
    }),
    [state, initialize, logout, network, ordApiBaseUrl, resolvedFetch, resolvedTheme],
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
