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
    splitting: false,
    sourcemap: true,
    target: "es2020",
    external: ["react", "react-native"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
