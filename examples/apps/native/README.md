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

## Kontor (KOR / NFTs) runs natively

Web/Node back `@kontor/sdk` with a **WebAssembly** component, which **Hermes** —
React Native's default JS engine — cannot host (it ships no `WebAssembly`). So on
native the SDK instead uses **`@kontor/sdk-native`**: a **JSI TurboModule**
(uniffi bindings over the same Rust core that the indexer compiles), selected
automatically via `@kontor/sdk`'s `react-native` conditional export. On-device
bytes are identical to the chain's verification path, and the calls stay
synchronous — same API as web.

Wiring in this app:

- **Dependency** — `@kontor/sdk-native` (see `package.json`).
- **Expo config plugin** — `"@kontor/sdk-native"` in `app.json` `plugins`; on
  `expo prebuild` it links the prebuilt native binaries and raises the required
  floors (iOS deployment target ≥ 15.1, Android `minSdkVersion` ≥ 24).
- **Metro** — `@kontor/sdk-native` is pinned to a single copy so its JSI module
  registers once (see `metro.config.js`).

The Horizon SDK still reaches `@kontor/sdk` only through **guarded dynamic
`import()`s** (`src/kontor/runtime.ts`), code-split into lazy chunks (`tsup`
`splitting: true`), so the native backend never installs at app startup — Kontor
loads the first time a KOR/NFT read or a Kontor swap runs. If the native module
is not linked (e.g. a build without the plugin), Kontor degrades gracefully:
reads return empty holdings, writes throw a clear `KontorUnavailableError`.

| Feature | Depends on Kontor? | On native |
| --- | --- | --- |
| BTC swaps, buy/sell | no | ✅ works |
| Counterparty / XCP (+ all CP tokens) | no | ✅ works |
| ZELD | no | ✅ works |
| Wallet, BTC balances, withdraw | no | ✅ works |
| **KOR token + Kontor NFTs** | yes | ✅ works (via `@kontor/sdk-native`) |

Kontor is **signet-only** today (`kontorNetwork: "signet"`) and inert on mainnet.

> Note: `@kontor/sdk` and `@kontor/sdk-native` are consumed from the npm registry
> (both pinned to `0.3.0-rc.5`), and the native binaries (iOS xcframework +
> Android `.so`s) ship inside the `@kontor/sdk-native` tarball — no local build.
> Two `postinstall` scripts (`scripts/fix-kontor-*.cjs`) patch known packaging
> defects still present in that rc.5 tarball; delete them once `@kontor/sdk-native`
> ships the fix (rc.6). This wiring typechecks cleanly (`npx tsc --noEmit`);
> on-device verification is pending a native rebuild (`npx expo run:ios` /
> `run:android`).

## App lock (biometrics / device passcode)

Once a wallet session exists, the app is gated behind the OS authentication
sheet — Face ID / Touch ID / fingerprint, with the device passcode/PIN as the
fallback (the "enter your phone code" escape hatch when biometrics fail). This
mirrors banking-app behaviour (e.g. Kraken). Implemented with
[`expo-local-authentication`](https://docs.expo.dev/versions/latest/sdk/local-authentication/):

- **Scope** — only locks when a wallet is connected; browsing the public market
  with no wallet is never gated (`components/AppLock.tsx` reads the SDK's
  `addresses` via `<AppLockBridge/>`).
- **Cold start** — the moment a restored session produces addresses, the lock
  overlay covers the whole app (Header included) until the OS auth succeeds.
- **Background** — re-locks after a ~30s grace period in the background, so a
  quick app-switch doesn't force a re-scan.
- **Fallback** — `authenticate()` passes `disableDeviceFallback: false`, so iOS
  offers "Enter Passcode" and Android allows the device credential. A device with
  no biometrics **and** no passcode can't be gated, so the lock is skipped there
  (nothing to authenticate against).
- **Fresh login = unlocked** — an interactive Web3Auth login (`getPrivateKey`
  with an email) counts as satisfying the lock for that session, so you're not
  prompted for Face ID on top of the login you just completed. A cold-start
  *restore* (`getPrivateKey("")`) still requires biometrics. Wired through the
  tiny `lib/app-lock-events.ts` bridge.

The lock state lives in `AppLockProvider`, mounted **outside**
`HorizonMarketProvider` so it survives the provider's `key={network}` remount on
a network switch (otherwise every switch would force a spurious re-auth).

### Privacy screen (app-switcher)

`components/PrivacyScreen.tsx` covers the app with an opaque brand screen whenever
it leaves the foreground (any non-`active` AppState), so the OS multitasking
snapshot doesn't leak balances/addresses. It's a JS-only cover — reliable on iOS;
on Android a native `FLAG_SECURE` would be more airtight but would also block all
screenshots, which isn't the goal here.

> Requires a native rebuild: `expo-local-authentication` is a native module and
> the Face ID usage string is added via an `app.json` config plugin, so run
> `npx expo run:ios` / `npx expo run:android` (or `npx expo prebuild --clean`)
> after pulling — `expo start` against an old binary won't pick it up.

## Web3Auth

Login opens the system browser via `expo-web-browser` and returns through the
`horizonmarket://auth` deep link (the `horizonmarket` scheme is set in
`app.json`). The Web3Auth client ID's allowlist must include this redirect URL.
