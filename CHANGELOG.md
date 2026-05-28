# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
