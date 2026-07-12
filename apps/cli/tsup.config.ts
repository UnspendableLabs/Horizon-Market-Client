import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// The CLI is versioned with the SDK it ships with (see the root tsup.config.ts,
// which bundles this same entry as the published package's `horizon` bin).
const sdkPkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

// Single ESM entry → `dist/index.js`, executable via the `horizon` bin. The
// shebang banner lets the built file run directly (`./dist/index.js`). The SDK
// (`@unspendablelabs/horizon-market-client`) is external — installed via
// `file:../..`, consumed from its own `dist/`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  define: { __HORIZON_CLI_VERSION__: JSON.stringify(sdkPkg.version) },
});
