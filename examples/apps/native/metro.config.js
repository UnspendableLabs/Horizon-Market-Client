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

// Alias bare `buffer` imports to the pure-JS `buffer` package, and shim the Node
// core modules that the bitcoin crypto chain (bip322-js → bitcoinjs-message →
// create-hash / cipher-base / secp256k1) deep-imports. RN ships none of these.
//
// NB: NOT @craftzdog/react-native-buffer — it depends on react-native-quick-base64,
// a C++ TurboModule that only registers under the New Architecture. This app runs
// the old architecture, so anything that imports it crashes at startup with
// `TurboModuleRegistry.getEnforcing('QuickBase64') could not be found`. Routing all
// `buffer` imports to the pure-JS package keeps quick-base64 out of the graph.
const nm = (name) => path.resolve(projectRoot, "node_modules", name);
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: nm("buffer"),
  stream: nm("stream-browserify"),
  events: nm("events"),
  util: nm("util"),
  string_decoder: nm("string_decoder"),
  process: nm("process"),
  // Force a SINGLE copy of React / React Native. The SDK is linked via
  // `file:../../..`, so its `import ... from "react"` would otherwise resolve to the
  // repo-root React (a different version than this app's), giving the SDK a mismatched
  // — effectively null — React and crashing its components with
  // `Cannot read property 'useState' of null`. Pinning both to this app's copy (and
  // letting Metro append subpaths like `react/jsx-runtime`) keeps one React instance.
  react: nm("react"),
  "react-native": nm("react-native"),
};

// Expo SDK 55's Metro enables package `exports` resolution with correct default
// conditions, so the SDK's subpaths (e.g. `.../react` → dist/react/index.native.js
// via the `react-native` condition) resolve out of the box. Do NOT override
// `unstable_conditionNames` here: forcing `"import"` into the list made CJS
// `require('@babel/runtime/helpers/…')` resolve to the ESM helper (`{default: fn}`),
// so web3auth crashed at load with `TypeError: Object is not a function`.

// Local imports use the NodeNext convention (`./x.js` referring to the `x.ts`
// source). Metro won't swap a `.ts` source in for an explicit `.js` request, so
// when a relative `.js`/`.jsx` specifier fails to resolve, retry it against the
// matching TypeScript source.
const EMPTY_MODULE = path.resolve(projectRoot, "lib/empty-module.js");

// Packages that MUST resolve to a single instance shared between this app and the
// file-linked SDK — React (its hook dispatcher) plus native modules / view managers
// that throw if registered twice. Pinned in resolveRequest below.
const SINGLETON_PACKAGES = [
  "react",
  "react-native",
  "react-native-svg",
  "react-native-safe-area-context",
  "@react-native-async-storage/async-storage",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force a SINGLE copy of the framework + native singleton packages. The SDK is
  // linked via `file:../../..`, so its imports of these resolve (via package
  // `exports`, which bypasses extraNodeModules aliases) to the repo-root copies —
  // different instances than this app's. Duplicates break in two ways:
  //   • two `react` copies → two hook dispatchers → the SDK's components crash with
  //     `Cannot read property 'useState' of null`;
  //   • two `react-native-svg` copies → each registers the native views →
  //     `Tried to register two views with the same name RNSVGCircle`.
  // Resolving these specifiers as if imported from the app root pins every copy to
  // this app's node_modules. Each entry matches the package and its subpaths but not
  // longer names (the `(\/|$)` boundary keeps `react` from matching `react-native`).
  if (SINGLETON_PACKAGES.some((p) => moduleName === p || moduleName.startsWith(p + "/"))) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, "index.ts") },
      moduleName,
      platform,
    );
  }
  // Node-only builtins reached through @kontor/sdk (node:fs, node:path, …).
  // Kontor is inert on Hermes, so stub them to an empty module to let the bundle
  // build. Covers both `node:`-prefixed and bare specifiers.
  if (/^node:/.test(moduleName) || /^(fs|path|os)(\/.*)?$/.test(moduleName)) {
    return { type: "sourceFile", filePath: EMPTY_MODULE };
  }
  // @kontor/sdk is WASM-backed with a top-level `await $init` that Hermes cannot
  // parse. The SDK only ever reaches it through guarded dynamic imports (the
  // runtime guard throws KontorUnavailableError first on Hermes), so keep it out
  // of the bundle entirely by stubbing it.
  if (moduleName === "@kontor/sdk" || moduleName.startsWith("@kontor/sdk/")) {
    return { type: "sourceFile", filePath: EMPTY_MODULE };
  }
  if (/^\.\.?\//.test(moduleName) && /\.jsx?$/.test(moduleName)) {
    const candidates = moduleName.endsWith(".jsx")
      ? [moduleName.replace(/\.jsx$/, ".tsx")]
      : [moduleName.replace(/\.js$/, ".ts"), moduleName.replace(/\.js$/, ".tsx")];
    for (const candidate of [moduleName, ...candidates]) {
      try {
        return context.resolveRequest(context, candidate, platform);
      } catch {
        // try the next candidate
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
