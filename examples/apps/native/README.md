# Horizon Market — Native Example (Expo)

An Expo / React Native app demonstrating the
`@unspendablelabs/horizon-market-client` library: Web3Auth login (email
passwordless), a swap list, a sell flow, and a runtime mainnet ⇄ signet switch.

## Local development

```bash
# from the repo root: build the library once so the file: dependency resolves
npm install && npm run build

cd examples/apps/native
npm install
npx expo start
```

Environment variables use the `EXPO_PUBLIC_*` prefix (inlined by Expo at build
time) and live in `.env` (gitignored — create it locally). Web3Auth vars are
**shared** across networks (one login derives both mainnet and signet addresses);
only the network-specific URLs get a `_SIGNET` twin. The keys are:

```
EXPO_PUBLIC_DEFAULT_NETWORK=mainnet         # mainnet | signet (initial selection)
EXPO_PUBLIC_WEB3AUTH_CLIENT_ID=...          # shared across networks
EXPO_PUBLIC_WEB3AUTH_NETWORK=...            # e.g. sapphire_devnet

# Mainnet (blank API URLs fall back to the example's public defaults)
EXPO_PUBLIC_HORIZON_MARKET_URL=             # blank → https://horizon.market
EXPO_PUBLIC_ORD_API_URL=                    # optional — enables ordinals
EXPO_PUBLIC_COUNTERPARTY_API_URL=           # optional — default api.counterparty.io
EXPO_PUBLIC_ZELD_API_URL=                   # optional — default api.zeldhash.com
EXPO_PUBLIC_KONTOR_INDEXER_URL=             # reserved (Kontor is signet-only today)
EXPO_PUBLIC_KONTOR_NFT_CONTRACT=            # reserved (mainnet Kontor — future)

# Signet twins
EXPO_PUBLIC_HORIZON_MARKET_URL_SIGNET=      # blank → https://signet.horizon.market
EXPO_PUBLIC_ORD_API_URL_SIGNET=             # optional
EXPO_PUBLIC_COUNTERPARTY_API_URL_SIGNET=    # Counterparty supports signet
EXPO_PUBLIC_ZELD_API_URL_SIGNET=            # set once ZELD signet API exists
EXPO_PUBLIC_KONTOR_INDEXER_URL_SIGNET=      # blank → public signet indexer
EXPO_PUBLIC_KONTOR_NFT_CONTRACT_SIGNET=     # optional — owned-NFT lookup
```

API base URLs are resolved **per network**: on mainnet a blank value uses the
SDK's public default; on any other network the Counterparty/ZELD APIs are called
only when their URL is set (so balances are never read against the wrong
network).

## ⚠️ Known blocker — not verified on a device

This native example is **unverified on a real device or simulator**, and is
**expected to crash at startup** in its current form. The reason:

- `@kontor/sdk` (a transitive dependency of the client SDK) is **WebAssembly-
  backed** and touches `WebAssembly.*` at **module-load time** — a top-level
  `new WebAssembly.Global(...)` and a top-level `await $init` that compiles and
  instantiates the embedded WASM module.
- **Hermes**, React Native's default JS engine, has **no `WebAssembly`**. So
  merely *importing* `@kontor/sdk` throws
  `ReferenceError: WebAssembly is not defined`.
- The client SDK imports `@kontor/sdk` **eagerly and unconditionally**
  (`dist/react/index.native.js` → `import { LocalKey } from "@kontor/sdk"`, via
  `crypto/signer.ts`). The `<HorizonMarketProvider>` pulls that module in, so the
  crash happens at app startup on **both mainnet and signet** — it is **not**
  limited to Kontor (KOR / NFT) reads, and **not** limited to signet.

### Things that do NOT fix it

- A Metro `WebAssembly` shim/polyfill: the top-level `await $init` must actually
  compile and run the module, which Hermes cannot do regardless of a stub object.

### What a real fix would require

- An **SDK change** to lazy-load `@kontor/sdk` (e.g. dynamic `import()` only when
  a Kontor operation runs), so the WASM module never evaluates on import. That is
  **out of scope** for this example (we do not modify the SDK's `src/`).

The rest of this example — polyfills, Web3Auth wiring, the network switch, the
footer, and `SessionRestorer` — is implemented and typechecks cleanly
(`npx tsc --noEmit`), but cannot be exercised end-to-end until the SDK can load
on Hermes. The **web** example is unaffected (browsers ship WebAssembly).

## Web3Auth

Login opens the system browser via `expo-web-browser` and returns through the
`horizonmarket://auth` deep link (the `horizonmarket` scheme is set in
`app.json`). The Web3Auth client ID's allowlist must include this redirect URL.
