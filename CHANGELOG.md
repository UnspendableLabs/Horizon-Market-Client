# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/UnspendableLabs/Horizon-Market-Client/releases/tag/v0.1.0
