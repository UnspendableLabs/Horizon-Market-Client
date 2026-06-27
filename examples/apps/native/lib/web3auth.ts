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
 */
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import Web3Auth, { LOGIN_PROVIDER } from "@web3auth/react-native-sdk";
import {
  CHAIN_NAMESPACES,
  WEB3AUTH_NETWORK,
  type WEB3AUTH_NETWORK_TYPE,
} from "@web3auth/base";
import { CommonPrivateKeyProvider } from "@web3auth/base-provider";

const REDIRECT_URL = "horizonmarket://auth";

const clientId = process.env.EXPO_PUBLIC_WEB3AUTH_CLIENT_ID ?? "";

const web3AuthNetwork: WEB3AUTH_NETWORK_TYPE =
  (process.env.EXPO_PUBLIC_WEB3AUTH_NETWORK as
    | WEB3AUTH_NETWORK_TYPE
    | undefined) ?? WEB3AUTH_NETWORK.SAPPHIRE_MAINNET;

// chainNamespace OTHER + CommonPrivateKeyProvider → the provider hands back the
// raw secp256k1 private key (not an EVM/Solana-derived value), so derived
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

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    // init() restores any persisted session (from expo-secure-store) and, if
    // present, sets up web3auth.provider — so a subsequent probe returns the key.
    await web3auth.init();
    initialized = true;
  }
}

async function readPrivateKey(): Promise<string> {
  if (!web3auth.provider) return "";
  const key = (await web3auth.provider.request({
    method: "private_key",
  })) as string;
  return key ?? "";
}

/**
 * Called by LoginPanel with:
 *  - email="" → probe for an existing session (on mount / after deep-link return)
 *  - email="user@example.com" → trigger the Web3Auth email passwordless flow
 *
 * Returns the hex private key, or "" if no session exists.
 */
export async function getPrivateKey(email: string): Promise<string> {
  await ensureInitialized();

  if (!email) {
    // Auto-detect an existing session without prompting the user.
    if (web3auth.connected) {
      return readPrivateKey();
    }
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

  return readPrivateKey();
}

/**
 * Logs out of Web3Auth, clearing its persisted session (expo-secure-store).
 * Without this, the session survives an app relaunch and the startup probe in
 * App.tsx (getPrivateKey("")) would silently reconnect — so the Disconnect
 * button must call this in addition to Horizon Market's own logout.
 */
export async function logout(): Promise<void> {
  await ensureInitialized();
  if (web3auth.connected) {
    await web3auth.logout();
  }
}
