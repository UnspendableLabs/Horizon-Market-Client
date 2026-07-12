// Custom entry so the crypto/Node-shim polyfills run BEFORE expo-router/entry pulls
// in the SDK / bitcoinjs / @web3auth graph (global.Buffer, crypto.getRandomValues,
// TextEncoder, process.* must exist first). Mirrors Kamera's apps/mobile/index.ts.
import "./lib/polyfills.js";
import "expo-router/entry";
