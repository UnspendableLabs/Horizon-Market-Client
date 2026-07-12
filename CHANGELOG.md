# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-13

### Added

- Kontor (KOR token + NFT) atomic swaps on signet: `listingType: "kontor"` across `openSellOrder` / `fillSwaps` / `delistSwap`, composed and broadcast client-side by the embedded `@kontor/sdk`; client options `kontorNetwork` / `kontorIndexerUrl`; `previewKontorListingFee`; orphan-recovery errors `KontorListingNotRecordedError`, `KontorPurchaseNotRecordedError`, `KontorDelistNotRecordedError`, plus `KontorUnavailableError`
- Mnemonic / BIP39 support (pure-JS, web/native-safe): `generateMnemonic`, `validateMnemonic`, `mnemonicToPrivateKey`, `DEFAULT_DERIVATION_PATH` (BIP86 `m/86'/0'/0'/0/0`), and `LocalSigner.fromMnemonic(...)` — the single-key web3auth model (one BIP86 key backs both addresses)
- `HDSigner` — Horizon-Wallet-compatible two-key derivation (BIP84 segwit + BIP86 taproot, `coin_type` per network) with helpers `deriveHorizonWalletKeys`, `horizonWalletPath`, `coinTypeForNetwork`, `privateKeyToMnemonic`. The new `HorizonMarketClient` options `mnemonic` / `mnemonicOptions` (`{ account?, passphrase? }`; precedence `signer` > `privateKey` > `mnemonic`) derive via `HDSigner.fromMnemonic`
- Unified send / withdraw for every supported asset type (BTC / Counterparty / ZELD / ordinal / KOR / Kontor NFT): `prepareSend` (exact fee + `broadcast()`) and `send`, with `SendRequest` / `SendResult` / `PreparedSend` types and inscription-UTXO protection
- Wallet sign-in & platform-fee credits: `signInWithWallet` (bearer token) / `signInWithWalletCookie`, `getCredits`, `getSession`, `isAuthenticated`, `signOut`; client options `bearerToken` / `sessionToken`
- Cross-platform encrypted keystore helpers (string → string, no file I/O): `encryptKeystore` / `decryptKeystore` (scrypt + AES-256-GCM) and the `Keystore` type, reusable in Node, the browser and React Native
- The `horizon` CLI (`init` / `list` / `balances` / `sell` / `buy` / `send`) ships as the package **bin** — `npm install -g @unspendablelabs/horizon-market-client` puts `horizon` on the PATH. Source in `apps/cli` (a full non-React integration); `init --import` imports a mnemonic via hidden prompt or stdin (no argv exposure)
- Wallet UI (React / React Native): `WithdrawForm`, `WalletBalances`, `WalletBalanceSummary`, `Modal`, plus hooks `useBtcBalance`, `useWithdraw`, `usePrices`, `useFeeEstimates`
- Optional progress callbacks on workflow methods (`openSellOrder`, `fillSwaps`, `delistSwap`) via a second `WorkflowOptions` argument with `onProgress`
- Exported progress types: `WorkflowProgressEvent`, `WorkflowOptions`, `OpenSellOrderStep`, `FillSwapsStep`, `DelistSwapStep`
- React / React Native UI layer (`@unspendablelabs/horizon-market-client/react`): `HorizonMarketProvider`, headless hooks, and platform components (`LoginPanel`, `SwapList`, `SellOrderForm`, `SwapConfirmation`, `WorkflowProgress`)
- `SwapList` / `useSwapList`: browse funded listings with filters, sort, pagination, and integrated buy/delist flows
- `AtomicSwap.imageUrl` and `AtomicSwap.thumbnailUrl` mapped from the API
- Owned-balance reads on `HorizonMarketClient`: `getCounterpartyBalances`, `getZeldBalances`, `getKontorHoldings` — read the connected wallet's real holdings across both addresses (Counterparty XCP/assets and ZELD via their public APIs, KOR + Kontor NFTs on signet). New types `CounterpartyBalance`, `ZeldBalance`, `KontorBalance`, `KontorNftHolding`, `KontorHoldings`
- Client/provider options: `counterpartyApiBaseUrl`, `zeldApiBaseUrl`, `kontorNftContractAddress`, plus `balancesCacheTtlMs` (provider). New exported defaults `DEFAULT_COUNTERPARTY_API_BASE_URL`, `DEFAULT_ZELD_API_BASE_URL`
- `useAssets` / `SellOrderForm` now list only the connected wallet's owned assets with balances, a persistent 1h cache, a "Refresh" button with "Updated <time>", and a human-units quantity field with a "Max" button

### Changed

- **Breaking (React surface):** the `SellOrderForm` asset picker now shows the connected wallet's real holdings (with balances) instead of a global asset-name search. `useAssets` is reshaped accordingly — `AssetOption` is now a discriminated union scoped to the holding address (`counterparty` / `zeld` / `ordinal` / `kor` / `kontor-nft`), `UseAssetsResult` exposes grouped lists plus `lastFetchedAt` / `isFetching` / `refresh`, and selling targets the holding address (`sellerAddress`) so assets on either address list correctly
- `getCredits` / `getSession` now return `null` only on auth-shaped statuses (401/403/404) and throw `HorizonMarketApiError` on transient server errors, so callers no longer mistake a 5xx for "signed out"
- `decryptKeystore` rejects out-of-bounds scrypt parameters in imported keystores (memory/CPU DoS hardening)
- Buyer-address validation now checks the full P2WPKH shape (42-char bech32), rejecting P2WSH addresses that share the `bc1q`/`tb1q` prefix

### Removed

- **Breaking (React surface):** the exported `zeldOption` constant — ZELD now appears only when actually held (read from the ZeldHash API), no longer a static dropdown entry
- **Breaking (React surface):** the never-applied `summary` (web + native `SellOrderForm` / web `WithdrawForm`) and native `dropdown` style/className slots

### Fixed

- Removed the package-root `react-native` field so Metro resolves the core client from the main entry; use the `./react` export for UI on React Native
- Sell form no longer offers assets the connected wallet does not own (empty addresses now show "No assets to sell" instead of a global catalogue)
- Kontor buy: a purchase-recording failure after the on-chain accept now throws `KontorPurchaseNotRecordedError` (carrying `swapId` / `txId` / `buyerAddress`) instead of a generic API error that lost the txid
- Counterparty balances above 2^53 base units no longer lose precision (rebuilt from the API's exact `quantity_normalized` string)
- Native `WithdrawForm` inputs no longer drop keystrokes on iOS/Fabric (uncontrolled-input pattern, matching `SellOrderForm`)
- Web `Modal` no longer closes when a drag that started inside the card (e.g. selecting text in an input) is released over the backdrop
- Swap-list thumbnails retry when the image URL changes instead of sticking on the error placeholder

## [0.1.0-rc.1] - 2026-05-28

### Added

- `HorizonMarketClient` with quote → sign → submit workflows:
  - `openSellOrder` — counterparty (existing UTXO + attach prep), ordinal, zeld (existing UTXO + transfer prep)
  - `fillSwaps` — counterparty, zeld, ordinal multi/single buy
  - `delistSwap` — BIP322 confirmation flow
- Typed REST helpers for all v1 atomic swap endpoints
- `LocalSigner` — P2WPKH + P2TR PSBT signing and BIP322 message signing
- `signAndFinalizeSellPrep` — helper for manual sell flows (attach / zeld transfer prep)
- ZELD idempotency handling (`created: false` on HTTP 200, 409 on conflict)
- Dual ESM/CJS build with TypeScript declarations

### Security

- Private keys never leave the client; only signed PSBTs and BIP322 signatures are sent to the API.

[0.1.0]: https://github.com/UnspendableLabs/Horizon-Market-Client/compare/v0.1.0-rc.1...v0.1.0
[0.1.0-rc.1]: https://github.com/UnspendableLabs/Horizon-Market-Client/releases/tag/v0.1.0-rc.1
