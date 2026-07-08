import { defineConfig } from "tsup";

// Single ESM entry → `dist/index.js`, executable via the `horizon` bin. The
// shebang banner lets the built file run directly (`./dist/index.js`). The SDK
// (`@unspendablelabs/horizon-market-client`) is external — installed via
// `file:../../..`, consumed from its own `dist/`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
