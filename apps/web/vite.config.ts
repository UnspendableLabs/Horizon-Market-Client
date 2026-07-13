import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The repo root, two levels up from this app. @kontor/sdk and the
// horizon-market-client (a `file:../..` link) are installed there, not in
// this app's node_modules.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// @scure/bip39's wordlist files (e.g. wordlists/english.js) end with a
// `//# sourceMappingURL=english.js.map` comment, but the package ships no .map
// files. @kontor/sdk deep-imports `@scure/bip39/wordlists/english.js`, and since
// the SDK is excluded from pre-bundling (see optimizeDeps below) it's served
// raw — so Vite's dev server reads the wordlist off disk, follows the dangling
// sourcemap reference, fails to find the .map, and logs "Failed to load source
// map" on every startup. Vite only extracts a file's sourcemap on the fs-read
// fallback path (loadAndTransform): if a `load` hook returns the code, it takes
// the branch that never calls extractSourcemapFromFile. So we serve the wordlist
// ourselves with the dangling comment stripped, skipping the warning entirely.
// (Targeting the subpath via optimizeDeps.include doesn't work: the app's own
// @scure/bip39 copy is a newer version whose exports map omits the `.js`
// specifier, so Vite throws "Missing specifier" at startup.)
function stripBip39WordlistSourcemaps(): Plugin {
  return {
    name: "strip-bip39-wordlist-sourcemaps",
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0];
      if (!/@scure[\\/]bip39[\\/]wordlists[\\/].+\.js$/.test(file)) return null;
      const code = await readFile(file, "utf8");
      return {
        code: code.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [
    stripBip39WordlistSourcemaps(),
    // bip322-js (used to BIP322-sign the wallet login challenge) pulls in a CJS
    // stack — bitcoinjs-message → cipher-base / readable-stream → node core
    // `stream`, `events`, `string_decoder`, … — that doesn't exist in the
    // browser. Polyfill those builtins (and the process/Buffer globals) for both
    // the dev optimizer and the production build. Without this, signing throws
    // "Cannot read properties of undefined (reading 'call')" at runtime.
    nodePolyfills({
      include: [
        "stream",
        "events",
        "string_decoder",
        "util",
        "buffer",
        "process",
        "crypto",
        "vm",
      ],
      globals: { Buffer: true, process: true, global: true },
    }),
    react(),
  ],
  server: {
    proxy: {
      // The Kontor signet indexer (signet.kontor.network:35100) sends no CORS
      // headers, so the browser blocks any direct cross-origin call to it
      // ("Failed to fetch"). Proxy it through the dev server so the SDK can hit
      // a same-origin relative path instead — set
      // VITE_KONTOR_INDEXER_URL_SIGNET=/kontor-signet to use this.
      // The indexer serves its routes under an `/api` prefix, so rewrite
      // `/kontor-signet/...` → `/api/...` (stripping to "" yields 404s).
      "/kontor-signet": {
        target: "https://signet.kontor.network:35100",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/kontor-signet/, "/api"),
      },
    },
    fs: {
      // This app has its own package-lock.json, so Vite infers the workspace
      // root as the app dir and refuses to serve files above it. @kontor/sdk
      // (and its sibling .wasm) live in the repo-root node_modules, so allow
      // reading from there — required once the SDK is excluded from
      // pre-bundling and served from its real location.
      allow: [repoRoot],
    },
  },
  build: {
    // A WASM-backed dependency uses top-level await, which is unavailable in
    // Vite's default build target (es2020). Target modern browsers that support
    // it so the production build (and the Vercel deploy) succeeds.
    target: "esnext",
  },
  optimizeDeps: {
    // @kontor/sdk loads a sibling WASM file via
    // `new URL('./kontor-sdk.core.wasm', import.meta.url)`. If Vite pre-bundles
    // the SDK into .vite/deps, import.meta.url points there — but the .wasm is
    // never copied alongside it, so the fetch falls through to the SPA HTML
    // fallback and WebAssembly.compileStreaming throws "Incorrect response MIME
    // type". Excluding it keeps the SDK served from node_modules, where the
    // .wasm sits right next to the module and resolves correctly.
    exclude: ["@kontor/sdk"],
    // @scure/bip39 ships `//# sourceMappingURL=` comments but no .map files, so
    // serving its main entry raw would make Vite try to read the missing maps.
    // Force it to be pre-bundled by esbuild — the bundled output drops those
    // dangling references. (It's a transitive dep of @kontor/sdk, which is
    // excluded above, so it would otherwise be served straight from node_modules.)
    // The deep wordlist subpaths can't be pre-bundled this way (see
    // stripBip39WordlistSourcemaps above) — that plugin handles them instead.
    //
    // bip322-js: a CJS-only library (with CJS deps: secp256k1, bitcoinjs-message,
    // ecpair, elliptic) that horizon-market-client uses to BIP322-sign the wallet
    // login challenge. The client is a `file:` link, so Vite's dep scanner never
    // crawls it and bip322-js is left un-optimized — served as raw CJS, it throws
    // "Cannot read properties of undefined (reading 'call')" the moment signing
    // runs. Force esbuild to pre-bundle it into clean ESM (secp256k1's `browser`
    // field resolves to its pure-JS `elliptic` impl, so no native binding is
    // pulled in). Same reason @scure/bip39 is listed above.
    //
    // vite-plugin-node-polyfills/shims/{buffer,process,global}: the plugin
    // injects these as global shims, but they're only discovered while crawling
    // the app — not during the initial optimize scan. That triggers a
    // mid-startup re-optimize + full reload, and because the re-optimization
    // reuses the same browserHash while regenerating the chunk files, an
    // already-open tab keeps importing a now-deleted `chunk-*.js?v=<hash>` →
    // 404 → blank page. Declaring them here makes them known before the first
    // optimize pass, so no reload happens.
    include: [
      "@scure/bip39",
      "bip322-js",
      "vite-plugin-node-polyfills/shims/buffer",
      "vite-plugin-node-polyfills/shims/process",
      "vite-plugin-node-polyfills/shims/global",
    ],
  },
});
