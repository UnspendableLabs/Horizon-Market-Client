import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";

export default defineConfig({
  plugins: [react()],
  build: {
    // A WASM-backed dependency uses top-level await, which is unavailable in
    // Vite's default build target (es2020). Target modern browsers that support
    // it so the production build (and the Vercel deploy) succeeds.
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
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
