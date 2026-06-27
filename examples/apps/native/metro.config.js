// Metro config for the Horizon Market native example.
//
// Two things to make the SDK + Web3Auth resolve under React Native:
//
// 1. The SDK is linked via `file:../../..`, and @kontor/sdk lives in the
//    repo-root node_modules (not this app's). Metro only watches the project
//    dir by default, so we add the repo root to `watchFolders` and let Metro
//    walk up to the root node_modules via `nodeModulesPaths`.
//
// 2. bitcoinjs-lib / @web3auth's torus deps deep-import the bare Node modules
//    `buffer` and `crypto`. RN ships neither. We alias `buffer` to the RN
//    buffer (also installed as the global Buffer in lib/polyfills.ts) so those
//    transitive imports resolve. (crypto.getRandomValues is provided globally
//    by react-native-get-random-values in lib/polyfills.ts.)
//
// ⚠️ KNOWN BLOCKER (UNVERIFIED ON DEVICE) — @kontor/sdk is WASM-backed and
//    evaluates `WebAssembly.*` at MODULE LOAD time: a top-level
//    `new WebAssembly.Global(...)` plus a top-level `await $init` that compiles
//    and instantiates the embedded module. Hermes (RN's default engine) has no
//    `WebAssembly`, so simply *importing* @kontor/sdk throws
//    `ReferenceError: WebAssembly is not defined` before any of its exports run.
//
//    The SDK imports it eagerly and UNCONDITIONALLY — dist/react/index.native.js
//    has a top-level `import { LocalKey } from "@kontor/sdk"` (from
//    crypto/signer.ts), which the provider pulls in. So the blast radius is the
//    ENTIRE app, not just Kontor: importing @unspendablelabs/.../react is
//    expected to crash at startup on BOTH mainnet and signet — not "Kontor reads
//    only", and not "signet only". A Metro `WebAssembly` shim does NOT fix this:
//    `await $init` needs to actually compile/run the module, which Hermes can't
//    do regardless of a shim. Making native work would require an SDK change to
//    lazy-load @kontor/sdk (out of scope here — we may not modify SDK src/).
//
//    This native example therefore ships UNVERIFIED on a real device. See
//    README.md for the full caveat. The web app is unaffected (browsers have
//    WebAssembly).

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
// examples/apps/native → repo root is three levels up.
const repoRoot = path.resolve(projectRoot, "../../..");

const config = getDefaultConfig(projectRoot);

// Watch the repo root so the linked SDK (and @kontor/sdk) are picked up.
config.watchFolders = [repoRoot];

// Resolve modules from both this app and the repo root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

// Alias bare `buffer` imports to the RN buffer implementation.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: path.resolve(projectRoot, "node_modules/@craftzdog/react-native-buffer"),
};

module.exports = config;
