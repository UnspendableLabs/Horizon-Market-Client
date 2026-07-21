# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-07-21

### Added

- React: new `onSellAsset?: (asset: AssetOption) => void` prop on the web `<WalletBalances/>` — override the per-asset "Sell" action. When provided, clicking Sell (on the XCP / KOR / ZELD headline tokens and on every "other holdings" tile) calls the host callback with the pre-selected asset instead of opening the built-in inline `<SellOrderForm/>` modal — e.g. to navigate to a dedicated Sell screen. When omitted, the internal modal is used as before. Brings the web component to parity with the native `WalletBalances`, which already exposes `onSellAsset`.
- Counterparty subasset **long names** are now captured and surfaced for display. Subassets list on-chain under a numeric `A…` name; the human-readable long name (e.g. `PEPENARDO.CARD`) was previously fetched from the API but discarded. Now:
  - `CounterpartyBalance` gains `assetLongname: string | null` (read from the balances endpoint's `asset_info.asset_longname`).
  - `AtomicSwap` gains `assetLongname?: string | null` (mapped from the `asset_longname` field the Horizon backend resolves on `listSwaps` / `getSwap`).
  - The owned-asset `AssetOption` (counterparty variant) gains `assetLongname?: string | null`.
- React: every packaged display surface now shows `assetLongname ?? assetName`, so subassets read as their long name instead of `A4950…` — the swap-list tiles / `<SwapList/>`, the buy & sell review screens (`<SwapConfirmation/>` / `<SellOrderForm/>`), and `<WalletBalances/>` (headline + "other holdings" tiles, deposit / withdraw modals, and the placeholder monogram). `assetName` remains the identifier used for image resolution and API calls; only the display label changed.

### Changed

- Withdraw / send: the wallet signature is now requested at **broadcast time, on confirm** — not while preparing the review screen. `prepareSend` (and `prepareBtc` / `prepareCounterparty` / `prepareZeld` / `prepareOrdinal`) now compose and fund the transaction but leave it **unsigned**; `PreparedSend.broadcast()` signs it (prompting the wallet) then publishes. The packaged `<WalletBalances/>` withdraw flow therefore shows its confirmation screen first and only pops the wallet when the user hits "Confirm & send". `feeSats` is unchanged — it is computed from UTXO selection at compose time, so the review screen still shows the exact miner fee before any signature. Kontor sends (`kor` / `kontor-nft`) were already sign-on-broadcast. `SendClient.send()` / `sendAsset()` (the one-shot `prepare().broadcast()` helpers) are unaffected.

## [0.2.0] - 2026-07-20

### Added

- Asynchronous signers: `Signer.signPsbtHex` / `signMessage` may now return `string` **or** `Promise<string>`, so a custom `Signer` can delegate to an external wallet (browser extension / mobile) that signs through a prompt and never exposes its key. Every workflow (`openSellOrder`, `fillSwaps`, `delistSwap`), send helper, and `signAndFinalizeSellPrep` awaits the result; `LocalSigner` / `HDSigner` are unchanged (still synchronous). `getAddresses()` stays synchronous.
- **Kontor now works with external wallets** (browser extension / mobile — Xverse, Horizon Wallet, …), not just in-process key signers. When a `Signer` doesn't implement `getKontorSigning` but exposes a Taproot address and its x-only public key (`getAddresses()` → `{ p2tr, xOnlyPubkey }`), the SDK builds a wallet-backed Kontor `Signing` that delegates transaction signing to `signPsbtHex` and message signing to `signMessage` — so `openSellOrder` / `fillSwaps` / `delistSwap` for KOR & Kontor-NFT listings run through the connected wallet's signing prompt, key never exposed. The wallet's **internal** taproot x-only key is Kontor's identity (re-tweaked to the P2TR address, which is asserted to match the wallet's own so a wrong key/network fails loudly). BLS registration (raw Schnorr-over-digest) is the only Kontor capability unavailable this way, and no marketplace flow needs it. Adds `@scure/btc-signer` / `@scure/base` as direct dependencies.
- React: `HorizonMarketProvider` context gains `initializeWithSigner(signer)` — connect from a host-supplied `Signer` (external wallet) instead of a raw key or phrase; addresses come from the signer, `exportMnemonic()` returns `null`, and `sessionSource` reports `"external"`.
- React: new `autoSignIn` prop on `HorizonMarketProvider` (default `true`) — set `false` to skip the automatic BIP322 wallet sign-in on connect (for hosts that authenticate another way, e.g. a same-origin session cookie, or an external signer whose message signing would pop the wallet). Sign-in stays available on demand via `client.signInWithWallet()`.
- React: exported the sell-review data layer — `useSellReview` plus `SellCost`, `UseSellReviewArgs`, `UseSellReviewResult`, `FeeOption`, and the `FEE_HINTS` / `FEE_LABELS` / `FEE_OPTIONS` constants. It powers the packaged `<SellOrderForm/>` confirm step (listing/attach/network cost breakdown, live fee-rate selection, fee waiver, Kontor listing + attach-miner fee estimates); exporting it lets a host render its own confirmation UI on the exact same data, the way apps already build on `useSellOrder`.
- React: exported the buy-review data layer — `useBuyReview` plus `UseBuyReviewArgs` / `UseBuyReviewResult` (its `FeeOption` and the `FEE_HINTS` / `FEE_LABELS` / `FEE_OPTIONS` constants are already exported via `useSellReview`). It powers the packaged `<SwapConfirmation/>` buy confirm step (price + royalty + buyer miner-fee breakdown, live fee-rate selection, Kontor estimates); exporting it lets a host render its own buy confirmation UI on the exact same data, symmetric with `useSellReview`.

### Changed

- **BREAKING:** `signAndFinalizeSellPrep(quote, signer, btcNetwork)` is now `async` and returns `Promise<SignedSellPrepResult | undefined>` (was synchronous), so it can await asynchronous signers. Add `await` at call sites.

### Fixed

- Native example app (iOS): fixed a launch crash on TestFlight and physical iPhones — `dyld: Library not loaded: @rpath/RNWorklets.framework/RNWorklets`. Expo 57's precompiled native modules shipped a dynamic `RNReanimated.framework` that links `@rpath/RNWorklets.framework`, but that `RNWorklets.framework` was not embedded in the device IPA, so dyld failed before JS started (the simulator build embedded it and hid the issue). `react-native-reanimated` and `react-native-worklets` are now forced to build from source via `expo.autolinking.ios.buildFromSource`; under the app's static linking they compile into static libs, so no dynamic `RNWorklets.framework` is produced and the `@rpath` load disappears. Both must be source-built together — building only worklets leaves the precompiled reanimated referencing the un-embedded framework.

## [0.1.2] - 2026-07-17

### Added

- Price-range and collection filters on `listSwaps`: new `ListSwapsParams.priceMin` / `priceMax` (inclusive bounds in sats) and `collection` (a collection slug the server expands to its asset names, so only Counterparty listings match) — combinable with every existing filter
- `HorizonMarketClient.getSwapFacets(params?, options?)` — one request returns reactive facet counts for a filter set (`SwapFacets`: listings per `type`, per price bucket, and per `collection`); each dimension is counted excluding its own active selection so sibling options keep clickable, non-zero counts. Takes the same filter shape as `listSwaps` minus pagination/sort (`SwapFacetsParams`); new types `SwapFacets`, `SwapFacetsParams`, `PriceBucketFacet` (USD presets resolved to sat-bounds server-side), and `CollectionFacet`

## [0.1.1] - 2026-07-17

### Added

- Pending-order surfacing on `listSwaps`: new `ListSwapsParams.pendingAddress` (a single address, or an array — one query prioritizes a wallet's in-progress orders across all its addresses) plus two new `AtomicSwap` fields, `pendingRole` (`"seller" | "buyer" | null`) and `pendingTxid` (`string | null`), populated only for that address's pending rows and `null` everywhere else
- `useSwapList` / `SwapList` — opt-in `includePendingOrders` surfaces the connected wallet's in-progress orders (pending sell listings still settling on-chain + pending purchases whose buy tx is unconfirmed) as `pendingOrders`, self-polling until each tx confirms; `trackPendingBuy(swap, txid)` optimistically shows a just-made Kontor buy immediately, independent of the server's `pending_address` decoration
- "Sold" feed on `useSwapList` / `SwapList` — `defaultShowSold` option and `showSold` / `setShowSold` / `canShowSold`: browse completed sales (the whole marketplace's, or narrowed to the wallet's own when combined with "My swaps"), as an independent dimension from the "My swaps" filter
- `HorizonMarketClient.recordKontorPurchase(swapId, { buyerAddress, txId })` — safe recovery that replays only the recording POST for a Kontor purchase whose swap reveal is already broadcast on-chain, never re-accepting (and re-broadcasting) the consumed offer
- `kontorPurchaseRecovery(err)` helper and the `KontorPurchaseRecovery` type — extract `{ swapId, txId, buyerAddress }` from a caught `KontorPurchaseNotRecordedError` without pulling the heavy `@kontor/sdk` backend into the main bundle

### Fixed

- Kontor KOR / NFT balance reads now resolve the wallet's registered Kontor `signer-id` (cached per x-only pubkey) and sum balances across every plausible holder ref (signer-id + both x-only-pubkey forms) — a wallet whose assets were credited to its signer-id previously read as a zero balance
- Kontor purchase recording failures now surface the real underlying cause instead of a generic error, and support a safe record-only retry

## [0.1.0] - 2026-07-13

Initial public release.

### Added

- `HorizonMarketClient` — quote → sign → submit atomic-swap workflows: `openSellOrder` (counterparty existing-UTXO + attach prep, ordinal, ZELD existing-UTXO + transfer prep), `fillSwaps` (counterparty / zeld / ordinal, single or multi-buy), and `delistSwap` (BIP322 confirmation)
- Typed REST helpers for all v1 atomic-swap endpoints, each accepting an optional `{ signal?: AbortSignal }` for cancellation
- `LocalSigner` — local P2WPKH + P2TR PSBT signing and BIP322 message signing
- `signAndFinalizeSellPrep` — signs and finalizes attach / ZELD transfer-prep PSBTs for manual sell flows
- Kontor (KOR token + NFT) atomic swaps on signet: `listingType: "kontor"` across `openSellOrder` / `fillSwaps` / `delistSwap`, composed, signed, and broadcast client-side by the embedded `@kontor/sdk`; client options `kontorNetwork` / `kontorIndexerUrl`; `previewKontorListingFee`; orphan-recovery errors `KontorListingNotRecordedError`, `KontorPurchaseNotRecordedError`, `KontorDelistNotRecordedError`, plus `KontorUnavailableError`
- Mnemonic / BIP39 support (pure-JS, web/native-safe): `generateMnemonic`, `validateMnemonic`, `mnemonicToPrivateKey`, `DEFAULT_DERIVATION_PATH` (BIP86 `m/86'/0'/0'/0/0`), and `LocalSigner.fromMnemonic` — the single-key web3auth model (one BIP86 key backs both addresses)
- `HDSigner` — Horizon-Wallet-compatible two-key derivation (BIP84 segwit + BIP86 taproot, `coin_type` per network) with helpers `deriveHorizonWalletKeys`, `horizonWalletPath`, `coinTypeForNetwork`, `privateKeyToMnemonic`. Client options `mnemonic` / `mnemonicOptions` (`{ account?, passphrase? }`; precedence `signer` > `privateKey` > `mnemonic`) derive via `HDSigner.fromMnemonic`
- Cross-platform encrypted keystore helpers (string → string, no file I/O): `encryptKeystore` / `decryptKeystore` (scrypt + AES-256-GCM) and the `Keystore` type, reusable in Node, the browser, and React Native
- Unified send / withdraw for every supported asset type (BTC / Counterparty / ZELD / ordinal / KOR / Kontor NFT): `prepareSend` (exact fee + `broadcast()`) and `send`, with `SendRequest` / `SendResult` / `PreparedSend` types and inscription-UTXO protection
- Owned-balance reads: `getCounterpartyBalances`, `getZeldBalances`, `getKontorHoldings` read the connected wallet's real holdings across both addresses; types `CounterpartyBalance`, `ZeldBalance`, `KontorBalance`, `KontorNftHolding`, `KontorHoldings`
- Wallet sign-in & platform-fee credits: `signInWithWallet` (bearer token) / `signInWithWalletCookie`, `getCredits`, `getSession`, `isAuthenticated`, `signOut`; client options `bearerToken` / `sessionToken`
- Optional progress callbacks on `openSellOrder` / `fillSwaps` / `delistSwap` via a second `WorkflowOptions` argument with `onProgress`; exported types `WorkflowProgressEvent`, `WorkflowOptions`, `OpenSellOrderStep`, `FillSwapsStep`, `DelistSwapStep`
- Client options `counterpartyApiBaseUrl`, `zeldApiBaseUrl`, `kontorNftContractAddress`, plus provider `balancesCacheTtlMs`; exported defaults `DEFAULT_COUNTERPARTY_API_BASE_URL`, `DEFAULT_ZELD_API_BASE_URL`
- `AtomicSwap.imageUrl` and `AtomicSwap.thumbnailUrl` mapped from the API
- React / React Native UI layer (`@unspendablelabs/horizon-market-client/react`): `HorizonMarketProvider`, headless hooks, and platform components `LoginPanel`, `SwapList`, `SellOrderForm`, `SwapConfirmation`, `WorkflowProgress`
- `SwapList` / `useSwapList` — browse funded listings with filters, sort, pagination, and integrated buy/delist flows
- `SellOrderForm` / `useAssets` — list only the connected wallet's owned assets with balances, a persistent 1h cache, a "Refresh" button with "Updated <time>", and a human-units quantity field with a "Max" button; `AssetOption` is a discriminated union scoped to the holding address (`counterparty` / `zeld` / `ordinal` / `kor` / `kontor-nft`)
- Wallet UI components `WithdrawForm`, `WalletBalances`, `WalletBalanceSummary`, `Modal`, plus hooks `useBtcBalance`, `useWithdraw`, `usePrices`, `useFeeEstimates`
- The `horizon` CLI (`init` / `list` / `balances` / `sell` / `buy` / `send`) ships as the package **bin** — `npm install -g @unspendablelabs/horizon-market-client` puts `horizon` on the PATH. Source in `apps/cli`; `init --import` imports a mnemonic via hidden prompt or stdin (no argv exposure)
- ZELD idempotency handling (transfer-prep creates may return HTTP 200 with `created: false` on replay, or 409 on conflict)
- Dual ESM/CJS build with TypeScript declarations

### Security

- Private keys never leave the client: write operations send only signed PSBTs, signed transactions, or BIP322 signatures to the API.
- `decryptKeystore` rejects out-of-bounds scrypt parameters in imported keystores (memory/CPU DoS hardening).

[0.2.0]: https://github.com/UnspendableLabs/Horizon-Market-Client/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/UnspendableLabs/Horizon-Market-Client/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/UnspendableLabs/Horizon-Market-Client/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/UnspendableLabs/Horizon-Market-Client/releases/tag/v0.1.0
