// Metro config for the Horizon Market native example.
//
// Two things to make the SDK + Web3Auth resolve under React Native:
//
// 1. The Horizon SDK is linked via `file:../../..`, so its source lives outside
//    this app's dir. Metro only watches the project dir by default, so we add the
//    repo root to `watchFolders` and let Metro also resolve from the repo-root
//    node_modules via `nodeModulesPaths`. (@kontor/sdk / @kontor/sdk-native now
//    come from the npm registry as direct deps of this app — no longer vendored.)
//
// 2. bitcoinjs-lib / @web3auth's torus deps deep-import the bare Node modules
//    `buffer` and `crypto`. RN ships neither. We alias `buffer` to the RN
//    buffer (also installed as the global Buffer in lib/polyfills.ts) so those
//    transitive imports resolve. (crypto.getRandomValues is provided globally
//    by react-native-get-random-values in lib/polyfills.ts.)
//
// 3. Kontor (KOR token + Kontor NFTs) runs natively via `@kontor/sdk-native` —
//    a JSI TurboModule (uniffi over the same Rust core) that `@kontor/sdk`
//    selects through its `react-native` conditional export, since Hermes has no
//    `WebAssembly`. The Horizon SDK reaches `@kontor/sdk` only through guarded
//    dynamic `import()`s (see src/kontor/runtime.ts), so nothing Kontor-related
//    evaluates at startup. `@kontor/sdk-native` is a dependency of this app, and
//    its Expo config plugin (see app.json `plugins`) links the prebuilt native
//    binaries during `expo prebuild`. It is pinned to a single copy below so the
//    JSI module registers exactly once.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

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
  // `@kontor/sdk` declares `@kontor/sdk-native` as a peer; route every request to
  // this app's copy so the JSI native module resolves and stays single.
  "@kontor/sdk-native": nm("@kontor/sdk-native"),
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
  // Kontor's JSI backend registers a native TurboModule at import — a second
  // copy (e.g. one nested under @kontor/sdk) would register it twice.
  "@kontor/sdk-native",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Kontor lazy-chunk redirect. The SDK code-splits every Kontor path behind a
  // dynamic `import()` (so the native-backed `@kontor/sdk` never evaluates at
  // startup — see the SDK's tsup.config `react/index.native` entry). Expo/Metro
  // serves those chunks as ON-DEMAND async bundles, fetched only when a Kontor op
  // first runs (e.g. buying KOR). Because the SDK is symlinked from the repo root
  // (OUTSIDE this project root), Metro miscomputes each chunk's request path as
  // `./dist/<chunk>` relative to THIS app instead of the SDK's real dist, so the
  // fetch fails with `Unable to resolve module ./dist/chain-… from …/native/.`.
  // Redirect any such `dist/<chunk>` request to the SDK's real dist. Existence-
  // gated on the repo-root dist, so it only ever fires for chunks that live there
  // (the app has no `dist/` of its own and imports nothing via `./dist/`).
  const distChunk = moduleName.match(/(?:^|\/)dist\/([A-Za-z0-9_-]+)(?:\.js)?$/);
  if (distChunk) {
    const real = path.join(repoRoot, "dist", `${distChunk[1]}.js`);
    if (fs.existsSync(real)) {
      return { type: "sourceFile", filePath: real };
    }
  }
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
  // Node-only builtins that transitive deps deep-import (node:fs, node:path, …).
  // RN ships none of them and nothing in the graph needs them at runtime, so stub
  // them to an empty module to let the bundle build. Covers both `node:`-prefixed
  // and bare specifiers. (The native @kontor/sdk backend imports no Node builtins.)
  if (/^node:/.test(moduleName) || /^(fs|path|os)(\/.*)?$/.test(moduleName)) {
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
