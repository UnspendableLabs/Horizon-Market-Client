import { defineConfig } from "tsup";

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
]);
