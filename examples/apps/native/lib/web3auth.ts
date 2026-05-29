/**
 * Web3Auth integration for React Native.
 *
 * Prerequisites:
 *   npm install @web3auth/react-native-sdk @web3auth/base expo-web-browser expo-auth-session
 *
 * Replace CLIENT_ID with your Web3Auth client ID from https://dashboard.web3auth.io
 *
 * Refer to the Web3Auth React Native docs for full setup:
 * https://web3auth.io/docs/sdk/pnp/react-native
 */

// TODO: Uncomment and configure once you have your Web3Auth credentials
// import * as WebBrowser from "expo-web-browser";
// import { Web3Auth, SdkLoginParams } from "@web3auth/react-native-sdk";
//
// const CLIENT_ID = "YOUR_WEB3AUTH_CLIENT_ID";
// const REDIRECT_URL = "horizonmarket://auth";
//
// const web3auth = new Web3Auth(WebBrowser, {
//   clientId: CLIENT_ID,
//   network: "sapphire_mainnet",
//   redirectUrl: REDIRECT_URL,
// });

/**
 * Called by LoginPanel with:
 *  - email="" → probe for an existing session (on mount)
 *  - email="user@example.com" → open Web3Auth login for this email
 *
 * Returns the hex private key, or "" if no session exists.
 */
export async function getPrivateKey(email: string): Promise<string> {
  // TODO: Replace this stub with the real Web3Auth implementation above
  if (!email) {
    return "";
  }

  // TODO: Uncomment once web3auth is configured:
  // await web3auth.login({ loginProvider: "email_passwordless", extraLoginOptions: { login_hint: email } });
  // return web3auth.privKey ?? "";

  throw new Error(
    "Web3Auth is not configured. See examples/apps/native/lib/web3auth.ts for setup instructions."
  );
}
