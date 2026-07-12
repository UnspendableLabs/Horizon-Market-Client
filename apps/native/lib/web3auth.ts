/**
 * Web3Auth integration for React Native (Expo).
 *
 * Same contract as the web app's lib/web3auth.ts so the SDK's
 * LoginPanel / SessionRestorer work unchanged:
 *   - getPrivateKey("")            → probe a persisted session, "" if none
 *   - getPrivateKey("a@b.com")     → run the email-passwordless login flow
 *   - logout()                     → clear the persisted session
 *
 * Returns the RAW secp256k1 private key (hex) — the same key bitcoinjs uses to
 * derive bc1…/tb1… addresses — NOT an EVM-namespaced value. That's achieved by
 * pairing a CommonPrivateKeyProvider with chainNamespace OTHER (mirrors web).
 *
 * Login opens the system browser via expo-web-browser and returns to the app
 * through the `horizonmarket://auth` deep link (scheme set in app.json).
 *
 * Requires EXPO_PUBLIC_WEB3AUTH_CLIENT_ID (and optionally
 * EXPO_PUBLIC_WEB3AUTH_NETWORK) in .env.
 *
 * ── Lazy loading (critical for startup) ─────────────────────────────────────
 * @web3auth/react-native-sdk (and its transitive stream/crypto graph) is heavy:
 * importing it AND constructing the Web3Auth instance at module load adds several
 * seconds of synchronous JS evaluation. On React Native that runs on the bridge's
 * startup path, and blocking it that long makes the bridge reset before the app
 * registers — a white screen that closes ("AppRegistry … n = 0"). So everything
 * below is imported dynamically and constructed on FIRST use: `getPrivateKey` /
 * `logout` are only called from effects (session restore, login tap), never during
 * the initial render, so the market UI boots immediately and Web3Auth spins up in
 * the background.
 */
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import type { WEB3AUTH_NETWORK_TYPE } from "@web3auth/base";
import { markFreshLogin } from "./app-lock-events.js";
import {
  getStoredKeyWithGate,
  setStoredKey,
  clearStoredKey,
  hasStoredKey,
} from "./secure-key-store.js";
import { hasMnemonicSession } from "./mnemonic-session.js";

const REDIRECT_URL = "horizonmarket://auth";

const clientId = process.env.EXPO_PUBLIC_WEB3AUTH_CLIENT_ID ?? "";

// The Web3Auth RN SDK persists its session id under this bare expo-secure-store
// key (KeyStore.set("sessionId", …) — NOT auth-gated), so we can detect a legacy
// session at cold start without a biometric prompt or loading the heavy SDK graph.
const WEB3AUTH_SESSION_KEY = "sessionId";

/**
 * In-memory copy of the unsealed key for THIS app process. Set the first time we
 * obtain the key (auth-gated keystore read, Web3Auth restore, or login) and reused
 * on later probes — crucially across the HorizonMarketProvider's network-switch
 * remount, so switching networks never re-triggers the biometric prompt. Cleared on
 * logout; lost on process death, so a genuine cold start re-reads (and re-prompts).
 */
let sessionKey: string | null = null;

/**
 * Fast (no Web3Auth init, no biometric prompt) probe of whether a session is worth
 * restoring. So the app-lock boot cover can hold until the lock is up instead of
 * flashing the market, this must be true for EVERY restorable session:
 *   - our cached raw key (the fast, no-Web3Auth restore path),
 *   - a stored recovery phrase (the Restore / New HD wallet path), and
 *   - a legacy Web3Auth session that predates the key cache — detected via the
 *     SDK's own un-gated "sessionId" marker, so a pre-existing session still keeps
 *     the cover up (then hands straight off to the lock once addresses land).
 * A genuinely logged-out user has none of these → the cover lifts immediately and
 * the public market shows without paying Web3Auth's lazy init.
 */
export async function hasPersistedSession(): Promise<boolean> {
  if (sessionKey != null || (await hasStoredKey())) return true;
  if (await hasMnemonicSession()) return true;
  return hasWeb3AuthSession();
}

/** Cheap presence check for a legacy Web3Auth session — no prompt, no SDK load. */
async function hasWeb3AuthSession(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(WEB3AUTH_SESSION_KEY)) != null;
  } catch {
    return false;
  }
}

type Web3AuthModule = typeof import("@web3auth/react-native-sdk");
type Web3AuthInstance = InstanceType<Web3AuthModule["default"]>;

// Memoized lazy initialization: dynamically import the Web3Auth packages, build the
// instance, restore any persisted session, and cache the resulting promise so every
// caller shares one initialized instance.
let ready: Promise<{
  web3auth: Web3AuthInstance;
  LOGIN_PROVIDER: Web3AuthModule["LOGIN_PROVIDER"];
}> | null = null;

function ensureWeb3Auth() {
  if (!ready) {
    ready = (async () => {
      const [rnSdk, base, baseProvider] = await Promise.all([
        import("@web3auth/react-native-sdk"),
        import("@web3auth/base"),
        import("@web3auth/base-provider"),
      ]);
      const Web3Auth = rnSdk.default;
      const { LOGIN_PROVIDER } = rnSdk;
      const { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } = base;
      const { CommonPrivateKeyProvider } = baseProvider;

      const web3AuthNetwork: WEB3AUTH_NETWORK_TYPE =
        (process.env.EXPO_PUBLIC_WEB3AUTH_NETWORK as
          | WEB3AUTH_NETWORK_TYPE
          | undefined) ?? WEB3AUTH_NETWORK.SAPPHIRE_MAINNET;

      // chainNamespace OTHER + CommonPrivateKeyProvider → the provider hands back
      // the raw secp256k1 private key (not an EVM/Solana-derived value), so derived
      // addresses match the web app exactly.
      const privateKeyProvider = new CommonPrivateKeyProvider({
        config: {
          chainConfig: {
            chainNamespace: CHAIN_NAMESPACES.OTHER,
            chainId: "0x1",
            rpcTarget: "https://rpc.ankr.com/eth",
          },
        },
      });

      const web3auth = new Web3Auth(WebBrowser, SecureStore, {
        clientId,
        network: web3AuthNetwork,
        redirectUrl: REDIRECT_URL,
        privateKeyProvider,
      });

      // init() restores any persisted session (from expo-secure-store) and, if
      // present, sets up web3auth.provider — so a subsequent probe returns the key.
      await web3auth.init();
      return { web3auth, LOGIN_PROVIDER };
    })();
  }
  return ready;
}

async function readPrivateKey(web3auth: Web3AuthInstance): Promise<string> {
  if (!web3auth.provider) return "";
  const key = (await web3auth.provider.request({
    method: "private_key",
  })) as string;
  const hex = key ?? "";
  // Single persistence choke point: cache the raw key so future cold starts skip
  // Web3Auth entirely (see secure-key-store.ts) and reuse it in-memory for the rest
  // of this session. Both the login and restore paths funnel through here.
  if (hex) {
    sessionKey = hex;
    await setStoredKey(hex);
  }
  return hex;
}

/**
 * Called by LoginPanel with:
 *  - email="" → probe for an existing session (on mount / after deep-link return)
 *  - email="user@example.com" → trigger the Web3Auth email passwordless flow
 *
 * Returns the hex private key, or "" if no session exists.
 */
export async function getPrivateKey(email: string): Promise<string> {
  // Fast path: on a restore probe, an already-unsealed key lets us skip loading the
  // heavy Web3Auth graph (and its network round-trip) entirely.
  if (!email) {
    // Already unsealed this session (e.g. a network-switch remount re-probing) →
    // reuse it with no keystore read, so switching networks never re-prompts.
    if (sessionKey) return sessionKey;
    // Cold start: the marker (no prompt) tells us a key exists; only then do we
    // read it. When the key is auth-gated the read triggers the OS prompt, and a
    // successful read means the user just passed OS auth to unseal it — that IS the
    // app-lock unlock for this cold start (markFreshLogin), so the lock never
    // prompts a second time on top. But a key stored UN-gated (emulator / no
    // enrolled authenticator at write time — see secure-key-store.ts) reads
    // SILENTLY: firing markFreshLogin there would skip the lock entirely, letting
    // the app open with no auth at all. So only mark a fresh login when the read
    // actually was an OS auth; otherwise leave the lock armed and let AppLock
    // present its own prompt (expo-local-authentication, which asks for the device
    // PIN/pattern even without biometrics).
    if (await hasStoredKey()) {
      // Read the key and whether it was gated in a SINGLE keychain round-trip.
      const { value: stored, gated } = await getStoredKeyWithGate();
      if (stored) {
        sessionKey = stored;
        if (gated) markFreshLogin();
        return stored;
      }
      // null → cancelled, or the key was invalidated by a biometric-enrollment
      // change. Fall through to a Web3Auth restore, which re-seeds the cache.
    }
  }

  const { web3auth, LOGIN_PROVIDER } = await ensureWeb3Auth();

  if (!email) {
    // Auto-detect an existing session without prompting the user. Legacy sessions
    // (created before the key cache existed) land here; readPrivateKey() then
    // seeds the cache so the next cold start takes the fast path above.
    if (web3auth.connected) return readPrivateKey(web3auth);
    return "";
  }

  // Open the email-passwordless flow with the email pre-filled. On native this
  // opens the in-app browser and resolves once the user returns via the
  // horizonmarket:// deep link.
  await web3auth.login({
    loginProvider: LOGIN_PROVIDER.EMAIL_PASSWORDLESS,
    extraLoginOptions: { login_hint: email },
  });

  if (!web3auth.connected || !web3auth.provider) {
    throw new Error("Web3Auth connection failed");
  }

  // Interactive login just succeeded → the user is authenticated, so the native
  // app-lock counts as unlocked for this session (no Face ID prompt on top of the
  // login they just did). Restores — getPrivateKey("") above — never reach here.
  markFreshLogin();

  // readPrivateKey() caches the raw key here, so the next cold start restores
  // instantly via the fast path in getPrivateKey() above.
  return readPrivateKey(web3auth);
}

/**
 * Logs out: wipes our cached raw key first (the user's revocation model —
 * disconnect erases the local key), then revokes the Web3Auth session
 * server-side. Without the latter the session would survive a relaunch and the
 * startup probe (getPrivateKey("")) could silently reconnect — so the Disconnect
 * button must call this in addition to Horizon Market's own logout.
 */
export async function logout(): Promise<void> {
  sessionKey = null;
  await clearStoredKey();
  try {
    // Only boot the heavy Web3Auth graph if there's actually a session to revoke.
    // If it was already initialized this run (`ready` set) the cost is paid, so
    // finish the revoke. Otherwise probe the SDK's un-gated "sessionId" marker
    // WITHOUT loading it: a mnemonic-only session never created one, so we skip the
    // init entirely. On an uncertain read we do NOT skip — revoke to be safe.
    if (ready == null) {
      let maybeSession = true;
      try {
        maybeSession =
          (await SecureStore.getItemAsync(WEB3AUTH_SESSION_KEY)) != null;
      } catch {
        maybeSession = true;
      }
      if (!maybeSession) return;
    }
    const { web3auth } = await ensureWeb3Auth();
    if (web3auth.connected) {
      await web3auth.logout();
    }
  } finally {
    // Belt-and-braces: guarantee no restorable Web3Auth session survives locally,
    // even if the revoke above threw (e.g. the device was offline). web3auth.logout()
    // deletes this "sessionId" entry on success, but had we left it after a failure
    // the next cold start's getPrivateKey("") probe would find it, re-init Web3Auth,
    // and silently reconnect the wallet the user just disconnected. Deleting it here
    // forces a fresh login next time — the raw key cache is already cleared above, so
    // this closes the last reconnect path. (A clean revoke makes this a harmless no-op.)
    try {
      await SecureStore.deleteItemAsync(WEB3AUTH_SESSION_KEY);
    } catch {
      /* non-fatal — nothing more we can do here */
    }
  }
}
