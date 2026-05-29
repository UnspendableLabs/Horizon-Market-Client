import { Web3Auth } from "@web3auth/modal";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK, type WEB3AUTH_NETWORK_TYPE } from "@web3auth/base";
import { CommonPrivateKeyProvider } from "@web3auth/base-provider";

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

const web3auth = new Web3Auth({
  clientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
  web3AuthNetwork,
  privateKeyProvider,
});

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await web3auth.initModal();
    initialized = true;
  }
}

/**
 * Called by LoginPanel with:
 *  - email="" → probe for an existing session (on mount / after OAuth redirect)
 *  - email="user@example.com" → open Web3Auth modal to authenticate
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

  // Open the Web3Auth modal — the email field is pre-filled by the modal itself
  await web3auth.connect();

  if (!web3auth.provider) throw new Error("Web3Auth connection failed");

  return (await web3auth.provider.request({ method: "private_key" })) as string;
}
