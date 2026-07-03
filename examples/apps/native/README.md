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

## Kontor (KOR / NFTs) is unavailable on native — everything else works

`@kontor/sdk` (a transitive dependency of the client SDK) is **WebAssembly-
backed**: it instantiates its WASM component at **module-load time** (a top-level
`new WebAssembly.Global(...)` and `await $init`) and relies on the JSPI
(`WebAssembly.promising`) stack-switching proposal. **Hermes** — React Native's
default JS engine — ships **no `WebAssembly`** at all, and no polyfill can host a
component that must actually compile and stack-switch. So **Kontor cannot run on
React Native today**, full stop.

Previously this crashed the app at *startup*, because the SDK imported
`@kontor/sdk` eagerly (via `crypto/signer.ts`), so `<HorizonMarketProvider>`
pulled the WASM in on mount. **That is now fixed in the SDK**: every Kontor code
path is reached through a dynamic `import()` guarded by a WebAssembly-availability
check (`src/kontor/runtime.ts`), and the native build code-splits those paths into
lazy chunks (`tsup` `splitting: true`). The WASM module therefore **never
evaluates at startup**, and the app boots on Hermes.

What this means in practice:

| Feature | Depends on Kontor? | On native |
| --- | --- | --- |
| BTC swaps, buy/sell | no | ✅ works |
| Counterparty / XCP (+ all CP tokens) | no | ✅ works |
| ZELD | no | ✅ works |
| Wallet, BTC balances, withdraw | no | ✅ works |
| **KOR token + Kontor NFTs** | yes | ⚠️ gracefully disabled |

Kontor is **signet-only** today (`kontorNetwork: "signet"`) and inert on mainnet,
so on **mainnet the native app is fully functional**. On **signet**, everything
works except Kontor: KOR/NFT balance reads degrade to empty holdings, and Kontor
sell/buy/delist throw a clear `KontorUnavailableError` instead of crashing the
host app. The **web** example is unaffected (browsers ship WebAssembly, so Kontor
works there).

> Note: this example is not yet verified end-to-end on a physical device /
> simulator, but it typechecks cleanly (`npx tsc --noEmit`) and the SDK bundle no
> longer evaluates WASM at load (verified against `dist/react/index.native.js`).

## Web3Auth

Login opens the system browser via `expo-web-browser` and returns through the
`horizonmarket://auth` deep link (the `horizonmarket` scheme is set in
`app.json`). The Web3Auth client ID's allowlist must include this redirect URL.
