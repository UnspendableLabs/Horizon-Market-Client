import { Web3AuthNoModal } from "@web3auth/no-modal";
import {
  CHAIN_NAMESPACES,
  WALLET_ADAPTERS,
  WEB3AUTH_NETWORK,
  type WEB3AUTH_NETWORK_TYPE,
} from "@web3auth/base";
import { CommonPrivateKeyProvider } from "@web3auth/base-provider";
import { AuthAdapter, UX_MODE } from "@web3auth/auth-adapter";

const privateKeyProvider = new CommonPrivateKeyProvider({
  config: {
    chainConfig: {
      chainNamespace: CHAIN_NAMESPACES.OTHER,
      chainId: "0x1",
      rpcTarget: "https://rpc.ankr.com/eth",
    },
  },
});

const web3AuthNetwork: WEB3AUTH_NETWORK_TYPE =
  (import.meta.env.VITE_WEB3AUTH_NETWORK as WEB3AUTH_NETWORK_TYPE | undefined) ??
  WEB3AUTH_NETWORK.SAPPHIRE_MAINNET;

// No-modal SDK: we drive the login flow ourselves instead of letting Web3Auth
// render its own provider-selection modal. This lets us go straight to the
// email passwordless (OTP) flow with the email the user already typed.
const web3auth = new Web3AuthNoModal({
  clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
  web3AuthNetwork,
  privateKeyProvider,
});

// uxMode "redirect" keeps the login in the same browser tab (no popup window):
// the page navigates to Web3Auth to enter the OTP code, then redirects back here,
// where the on-mount session probe in useLoginPanel picks up the connected session.
web3auth.configureAdapter(
  new AuthAdapter({
    privateKeyProvider,
    adapterSettings: { uxMode: UX_MODE.REDIRECT },
  }),
);

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await web3auth.init();
    initialized = true;
  }
}

/**
 * Called by LoginPanel with:
 *  - email="" → probe for an existing session (on mount / after OAuth redirect)
 *  - email="user@example.com" → trigger the Web3Auth email passwordless flow
 *
 * Returns the hex private key, or "" if no session exists.
 */
export async function getPrivateKey(email: string): Promise<string> {
  await ensureInitialized();

  if (!email) {
    // Auto-detect existing session without prompting the user
    if (web3auth.connected && web3auth.provider) {
      return (await web3auth.provider.request({
        method: "private_key",
      })) as string;
    }
    return "";
  }

  // Go straight to the email passwordless flow with the email pre-filled —
  // Web3Auth sends a one-time code to this address instead of showing its modal.
  // In redirect mode this navigates away and never resolves on this page load;
  // the session is picked up after the redirect returns (see ensureInitialized
  // + the startup session probe in App.tsx).
  await web3auth.connectTo(WALLET_ADAPTERS.AUTH, {
    loginProvider: "email_passwordless",
    extraLoginOptions: { login_hint: email },
  });

  if (!web3auth.provider) throw new Error("Web3Auth connection failed");

  return (await web3auth.provider.request({ method: "private_key" })) as string;
}

/**
 * Logs out of Web3Auth, clearing its persisted session (local/session storage).
 * Without this the session survives a page refresh and the startup probe in
 * App.tsx (getPrivateKey("")) would silently reconnect the user — so the
 * Disconnect button must call this in addition to Horizon Market's own logout.
 */
export async function logout(): Promise<void> {
  await ensureInitialized();
  if (web3auth.connected) {
    await web3auth.logout();
  }
}
