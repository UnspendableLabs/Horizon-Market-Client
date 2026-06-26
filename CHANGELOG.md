# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Removed

- **Breaking (React surface):** the exported `zeldOption` constant — ZELD now appears only when actually held (read from the ZeldHash API), no longer a static dropdown entry

### Fixed

- Removed the package-root `react-native` field so Metro resolves the core client from the main entry; use the `./react` export for UI on React Native
- Sell form no longer offers assets the connected wallet does not own (empty addresses now show "No assets to sell" instead of a global catalogue)

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

[Unreleased]: https://github.com/UnspendableLabs/Horizon-Market-Client/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/UnspendableLabs/Horizon-Market-Client/releases/tag/v0.1.0-rc.1
