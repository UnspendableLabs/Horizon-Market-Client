/**
 * Crypto / Node-shim polyfills for React Native.
 *
 * MUST be imported as the VERY FIRST line of App.tsx — before any bitcoinjs,
 * @web3auth, or SDK import — so `global.Buffer` and a CSPRNG-backed
 * `crypto.getRandomValues` exist before those modules initialize.
 *
 * Mirrors the web app's main.tsx shims (which set window.Buffer + a crypto
 * RNG via the browser), adapted to the RN global.
 */

// Installs crypto.getRandomValues backed by the native secure RNG. Imported for
// its side effect — keep this before anything that derives keys / signs.
import "react-native-get-random-values";

import { Buffer } from "@craftzdog/react-native-buffer";

// bitcoinjs-lib + @web3auth expect a global Buffer (Node-style). RN has none.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) {
  g.Buffer = Buffer;
}
