import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { resolveFetch } from "../api/resolveFetch.js";
import { HorizonMarketClient } from "../client.js";
import { DEFAULT_BASE_URL } from "../config.js";
import { HDSigner, LocalSigner, type Signer } from "../crypto/signer.js";
import { privateKeyToMnemonic } from "../crypto/mnemonic.js";
import type { Network } from "../types/index.js";
import {
  resolveTheme,
  type HorizonMarketTheme,
  type ResolvedTheme,
} from "./theme.js";

export type Addresses = ReturnType<Signer["getAddresses"]>;

/**
 * How a connected private key (e.g. a web3auth social-login key) is turned into
 * Bitcoin addresses:
 * - `"horizon-market"` (default) — the raw key backs BOTH p2wpkh and p2tr, one
 *   key for both (single-key model). Produces the SAME addresses as horizon.market.
 * - `"horizon-wallet"` — the key is bridged through a BIP39 mnemonic and addresses
 *   are derived the Horizon Wallet way (BIP84 segwit + BIP86 taproot, coin-type
 *   per network). Lets the user export a recovery phrase and reach the SAME
 *   addresses in the Horizon Wallet extension / XVerse. See {@link MnemonicWordCount}.
 */
export type DerivationMode = "horizon-market" | "horizon-wallet";

/**
 * Recovery-phrase length used by `"horizon-wallet"` mode. The web3auth key is
 * 256-bit, so `24` encodes it losslessly, while `12` reduces it to 128 bits
 * (`sha256(key)[:16]`) — required to import into the Horizon Wallet extension,
 * which only accepts 12-word phrases. The two lengths derive DIFFERENT addresses
 * (different seeds), so switching moves which addresses hold funds. Ignored in
 * `"horizon-market"` mode.
 */
export type MnemonicWordCount = 12 | 24;

export interface HorizonMarketContextValue {
  client: HorizonMarketClient;
  addresses: Addresses | null;
  initialize: (privateKey: string | Uint8Array) => void;
  logout: () => void;
  /** Active address-derivation mode (see {@link DerivationMode}). */
  derivationMode: DerivationMode;
  /**
   * Switch derivation mode. Re-derives the connected wallet's addresses in place
   * (no reconnect) and notifies the host via `onDerivationModeChange` so it can
   * persist the choice.
   */
  setDerivationMode: (mode: DerivationMode) => void;
  /** Recovery-phrase length for `"horizon-wallet"` mode (see {@link MnemonicWordCount}). */
  mnemonicWordCount: MnemonicWordCount;
  /** Change the phrase length; re-derives addresses in place and notifies the host. */
  setMnemonicWordCount: (words: MnemonicWordCount) => void;
  /**
   * The connected wallet's recovery phrase for the active `mnemonicWordCount`,
   * or `null` when not connected. Meaningful in `"horizon-wallet"` mode — importing
   * it into a compatible wallet reproduces the addresses shown. Reads the raw key
   * held in memory; gate the reveal behind your own auth (biometrics) as needed.
   */
  exportMnemonic: () => string | null;
  /**
   * Paid credits on the connected account, or `null` before sign-in resolves.
   * Free credits are spent before paid ones; each listing consumes 1 credit.
   */
  credits: number | null;
  /** Free monthly credits (0–10) on the connected account, or `null` pre-sign-in. */
  freeCredits: number | null;
  /** True once the wallet holds an authenticated Horizon Market session. */
  isAuthenticated: boolean;
  /** Re-read the credit balance from the server (e.g. after opening a listing). */
  refreshCredits: () => Promise<void>;
  /** Last wallet sign-in error message, or `null` when sign-in succeeded/pending. */
  signInError: string | null;
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
  /**
   * Initial address-derivation mode (see {@link DerivationMode}). Default
   * `"horizon-market"` (raw single-key, matches horizon.market). The host owns
   * persistence: seed this from storage and persist via `onDerivationModeChange`.
   */
  derivationMode?: DerivationMode;
  /** Called when the in-app toggle changes the mode, so the host can persist it. */
  onDerivationModeChange?: (mode: DerivationMode) => void;
  /**
   * Initial recovery-phrase length for `"horizon-wallet"` mode. Default `12`
   * (Horizon Wallet compatible). Persist changes via `onMnemonicWordCountChange`.
   */
  mnemonicWordCount?: MnemonicWordCount;
  /** Called when the in-app selector changes the phrase length, for persistence. */
  onMnemonicWordCountChange?: (words: MnemonicWordCount) => void;
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
  derivationMode = "horizon-market",
  onDerivationModeChange,
  mnemonicWordCount = 12,
  onMnemonicWordCountChange,
  children,
}: HorizonMarketProviderProps) {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  // Raw connected key, retained so a mode / word-count change can re-derive
  // addresses in place without a reconnect. Never surfaced except via
  // exportMnemonic() (mnemonic form). Held in a ref (not state) so it stays out
  // of the value object graph / memo deps.
  const privateKeyRef = useRef<string | Uint8Array | null>(null);
  const [session, setSession] = useState<{
    token: string;
    credits: number;
    freeCredits: number;
  } | null>(null);
  // Last wallet sign-in error (surfaced in the UI so failures aren't silent).
  const [signInError, setSignInError] = useState<string | null>(null);
  // The wallet ADDRESS we've already signed in for. Keyed on the stable address
  // (not the Signer object) so repeated initialize() calls with the same key —
  // e.g. StrictMode's double-invoke or a Web3Auth session-restore — dedupe to a
  // single sign-in instead of each new Signer object superseding the last.
  const signedInFor = useRef<string | null>(null);

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
            // Re-hydrate the authenticated session so quotes/orders are sent
            // authenticated (fee waived → 1 credit) even after re-memoization.
            bearerToken: session?.token,
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
      session?.token,
    ],
  );

  // Construct the signer for the current derivation mode:
  // - "horizon-market": single-key LocalSigner (raw key backs p2wpkh + p2tr) —
  //   the same addresses horizon.market produces.
  // - "horizon-wallet": HDSigner via a BIP39 mnemonic (BIP84 segwit + BIP86
  //   taproot, coin-type per network), so exporting the phrase and importing it
  //   into the Horizon Wallet extension / XVerse reaches the SAME addresses. The
  //   phrase length (mnemonicWordCount) selects which wallet: 12 words (Horizon
  //   Wallet) vs 24 words (full-key, XVerse & co.).
  const buildSigner = useCallback(
    (privateKey: string | Uint8Array): Signer =>
      derivationMode === "horizon-wallet"
        ? HDSigner.fromPrivateKey(privateKey, {
            network,
            words: mnemonicWordCount,
          })
        : new LocalSigner(privateKey, network),
    [derivationMode, mnemonicWordCount, network],
  );

  const initialize = useCallback(
    (privateKey: string | Uint8Array) => {
      privateKeyRef.current = privateKey;
      const signer = buildSigner(privateKey);
      setAuthState({ signer, addresses: signer.getAddresses() });
    },
    [buildSigner],
  );

  // Re-derive the connected wallet's addresses in place when the derivation mode
  // or phrase length changes (both captured by buildSigner). No-op until a key is
  // connected; the resulting address change flows into the sign-in effect below,
  // which re-authenticates for the new address. `network` also feeds buildSigner,
  // but a network switch remounts the whole provider (key={network}), so within a
  // mounted instance this only ever fires on a mode / word-count change.
  useEffect(() => {
    const pk = privateKeyRef.current;
    if (!pk) return;
    const signer = buildSigner(pk);
    setAuthState({ signer, addresses: signer.getAddresses() });
  }, [buildSigner]);

  // Mode / word-count are host-owned (controlled) so the choice can be persisted
  // and survive the network remount: the setters notify the host, which flips the
  // prop, which re-renders + re-derives via the effect above.
  const setDerivationMode = useCallback(
    (mode: DerivationMode) => onDerivationModeChange?.(mode),
    [onDerivationModeChange],
  );
  const setMnemonicWordCount = useCallback(
    (words: MnemonicWordCount) => onMnemonicWordCountChange?.(words),
    [onMnemonicWordCountChange],
  );

  // The recovery phrase for the active phrase length, from the retained key.
  const exportMnemonic = useCallback(
    (): string | null =>
      privateKeyRef.current
        ? privateKeyToMnemonic(privateKeyRef.current, {
            words: mnemonicWordCount,
          })
        : null,
    [mnemonicWordCount],
  );

  const logout = useCallback(() => {
    privateKeyRef.current = null;
    signedInFor.current = null;
    setSession(null);
    setAuthState(null);
  }, []);

  // After a wallet connects, establish a Horizon Market session so the account's
  // free credits waive the listing fee (1 credit consumed instead of an on-chain
  // fee). Runs once per connected signer; failure falls back to anonymous
  // (fee-paid) listings without blocking the app.
  //
  // Dedupe on the signer (not an effect cleanup flag) so this survives React
  // StrictMode's dev-only mount→cleanup→mount: the second pass early-returns
  // while the first pass's request completes, and the result is applied only if
  // the wallet hasn't changed since. Cancelling on cleanup here would instead
  // discard that first (only) request and leave the balance unresolved.
  useEffect(() => {
    if (!authState) {
      signedInFor.current = null;
      setSession(null);
      setSignInError(null);
      return;
    }
    const address = authState.addresses.p2wpkh;
    if (signedInFor.current === address) return;
    signedInFor.current = address;
    setSignInError(null);

    const signInClient = new HorizonMarketClient({
      signer: authState.signer,
      network,
      baseUrl,
      kontorNetwork,
      kontorIndexerUrl,
      counterpartyApiBaseUrl,
      zeldApiBaseUrl,
      kontorNftContractAddress,
      fetch: fetchImpl,
    });
    signInClient
      .signInWithWallet()
      .then((res) => {
        // Ignore a stale result if the wallet changed while signing in.
        if (signedInFor.current !== address) return;
        setSession({
          token: res.token,
          credits: res.credits,
          freeCredits: res.freeCredits,
        });
      })
      .catch((err) => {
        // Allow a retry on a later render if this is still the active wallet,
        // and surface the reason so the UI can show it instead of a silent "…".
        if (signedInFor.current === address) signedInFor.current = null;
        setSignInError(err instanceof Error ? err.message : String(err));
        console.error("Horizon Market wallet sign-in failed:", err);
      });
  }, [
    authState,
    network,
    baseUrl,
    kontorNetwork,
    kontorIndexerUrl,
    counterpartyApiBaseUrl,
    zeldApiBaseUrl,
    kontorNftContractAddress,
    fetchImpl,
  ]);

  const refreshCredits = useCallback(async () => {
    if (!authState) return;
    const balance = await (authedClient ?? anonClient).getCredits();
    if (balance) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              credits: balance.credits,
              freeCredits: balance.freeCredits,
            }
          : prev,
      );
    }
  }, [authState, authedClient, anonClient]);

  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  const resolvedFetch = useMemo(() => resolveFetch(fetchImpl), [fetchImpl]);

  const value = useMemo<HorizonMarketContextValue>(
    () => ({
      client: authedClient ?? anonClient,
      addresses: authState?.addresses ?? null,
      initialize,
      logout,
      derivationMode,
      setDerivationMode,
      mnemonicWordCount,
      setMnemonicWordCount,
      exportMnemonic,
      credits: session?.credits ?? null,
      freeCredits: session?.freeCredits ?? null,
      isAuthenticated: session !== null,
      refreshCredits,
      signInError,
      network,
      kontorNetwork,
      baseUrl: baseUrl ?? DEFAULT_BASE_URL,
      ordApiBaseUrl,
      balancesCacheTtlMs,
      fetch: resolvedFetch,
      theme: resolvedTheme,
    }),
    [authedClient, anonClient, authState, initialize, logout, derivationMode, setDerivationMode, mnemonicWordCount, setMnemonicWordCount, exportMnemonic, session, refreshCredits, signInError, network, kontorNetwork, baseUrl, ordApiBaseUrl, balancesCacheTtlMs, resolvedFetch, resolvedTheme],
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
