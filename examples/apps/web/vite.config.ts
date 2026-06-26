import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

// The repo root, three levels up from this example app. @kontor/sdk and the
// horizon-market-client (a `file:../../..` link) are installed there, not in
// this app's node_modules.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
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
    // serving it directly makes Vite try to read the missing maps and log
    // "Failed to load source map" on every startup. Force it to be pre-bundled
    // by esbuild — the bundled output drops those dangling references, silencing
    // the warning. (It's a transitive dep of @kontor/sdk, which is excluded
    // above, so it would otherwise be served straight from node_modules.)
    include: ["@scure/bip39"],
    esbuildOptions: {
      // The dev server pre-bundles deps with esbuild's default target
      // (es2020/chrome87/...), which lacks top-level await. A WASM-backed
      // dependency (@kontor/sdk) relies on it, so match the build target.
      target: "esnext",
      define: {
        global: "globalThis",
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          process: true,
          buffer: true,
        }),
      ],
    },
  },
});
