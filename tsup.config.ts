import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Cleaning is handled by the `clean` npm script (run before `tsup`). Setting
// `clean: true` on one entry while running multiple entries in parallel could
// race against the others' writes.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: "node20",
  },
  {
    entry: { "react/index": "src/react/index.web.ts" },
    format: ["esm", "cjs"],
    dts: true,
    splitting: false,
    sourcemap: true,
    target: "es2020",
    external: ["react"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    entry: { "react/index.native": "src/react/index.native.ts" },
    format: ["esm", "cjs"],
    dts: true,
    // Code-splitting is REQUIRED here (ESM output). The client reaches every
    // Kontor module through a dynamic `import()` so the WebAssembly-backed
    // `@kontor/sdk` never evaluates at startup — but without splitting, esbuild
    // inlines those modules into the single bundle and hoists their top-level
    // `import … from "@kontor/sdk"` to the entry, re-introducing the eager WASM
    // load that crashes React Native / Hermes. Splitting keeps the Kontor code
    // in separate async chunks, loaded only when a Kontor operation runs.
    splitting: true,
    sourcemap: true,
    target: "es2020",
    // `react-native-svg` (wallet/brand icons) and `expo-clipboard` (address copy)
    // are optional peers resolved by the consuming app, not bundled here.
    external: ["react", "react-native", "react-native-svg", "expo-clipboard"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    // The `horizon` CLI (apps/cli), shipped as this package's `bin` so a global
    // `npm install -g` puts `horizon` on the PATH. Its terminal-only helpers
    // (citty, prompts, colors, tables) are inlined via `noExternal`; the SDK
    // import stays external and resolves at runtime through Node's package
    // self-reference (the bin lives inside the package, so
    // `@unspendablelabs/horizon-market-client` resolves to `./dist/index.js`).
    entry: { "cli/index": "apps/cli/src/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    splitting: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@unspendablelabs/horizon-market-client"],
    noExternal: ["citty", "@clack/prompts", "cli-table3", "picocolors"],
    define: { __HORIZON_CLI_VERSION__: JSON.stringify(pkg.version) },
  },
]);
