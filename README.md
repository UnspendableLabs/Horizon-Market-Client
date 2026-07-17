[![CI](https://github.com/UnspendableLabs/Horizon-Market-Client/actions/workflows/ci.yml/badge.svg)](https://github.com/UnspendableLabs/Horizon-Market-Client/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/UnspendableLabs/Horizon-Market-Client/graph/badge.svg?token=aCoWURQQzj)](https://codecov.io/gh/UnspendableLabs/Horizon-Market-Client)
[![npm version](https://img.shields.io/npm/v/@unspendablelabs/horizon-market-client.svg)](https://www.npmjs.com/package/@unspendablelabs/horizon-market-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![TypeScript](https://img.shields.io/badge/TypeScript-6-blue.svg)

# @unspendablelabs/horizon-market-client

TypeScript client for the [Horizon Market](https://horizon.market) Atomic Swap API.

The API never receives your private key. Write operations use **signed PSBTs** (sell / buy / fee) or a **BIP322 message signature** (delist).

## Install

```bash
npm install @unspendablelabs/horizon-market-client
```

For the optional React UI (web or React Native), also install peer dependencies:

```bash
npm install react
# React Native apps only:
npm install react-native
# Optional native peers — wallet/brand icons and address copy:
npm install react-native-svg expo-clipboard
```

### CLI

The package ships the `horizon` CLI ([apps/cli](apps/cli)) as its `bin` — a global
install puts it on your PATH:

```bash
npm install -g @unspendablelabs/horizon-market-client
horizon --help    # init / list / balances / sell / buy / send
```

## Quote → sign → submit

Every write workflow follows the same pattern: the server composes unsigned PSBTs (or a delist message), you sign locally, then submit.

```mermaid
flowchart LR
  subgraph sell [Sell]
    SQ[sell-quotes] --> SS[Sign swap + fee PSBTs]
    SS --> SP[Sign + finalize prep if needed]
    SP --> SC[POST /atomic-swaps]
  end
  subgraph buy [Buy]
    BQ[buy-quotes] --> BS[Sign buyer PSBT]
    BS --> BP[POST /purchases]
  end
  subgraph delist [Delist]
    DS[start delist] --> DM[BIP322 sign request id]
    DM --> DC[PUT confirm]
  end
```

| Step | Sell | Buy | Delist |
|------|------|-----|--------|
| Quote | `POST sell-quotes` | `POST buy-quotes` | — |
| Sign | `prep_psbt` (finalize if present) + `swap_psbt` + `fee_psbt` | `psbt` (buyer inputs only) | BIP322 on delist `id` |
| Submit | `POST /atomic-swaps` | `POST /purchases` | `PUT delist-requests/{id}` |

Use the high-level workflow methods (`openSellOrder`, `fillSwaps`, `delistSwap`) or the REST helpers for manual control.

For manual sell flows, `signAndFinalizeSellPrep(quote, signer, btcNetwork)` signs and finalizes attach or zeld transfer prep PSBTs from a sell quote (`btcNetwork` is a bitcoinjs-lib `Network` object — see [examples/sell.ts](examples/sell.ts)).

## Progress callbacks

Pass an optional second argument to `openSellOrder`, `fillSwaps`, or `delistSwap` to receive step-by-step progress events (useful for progress bars and status text):

```ts
await client.openSellOrder(params, {
  onProgress: ({ stepIndex, totalSteps, message, phase, step }) => {
    if (phase === "start" && totalSteps != null) {
      setProgress(stepIndex / totalSteps);
    }
    setStatus(message);
    console.log(step, phase, message);
  },
});
```

Each step emits `phase: "start"` before work begins and `phase: "complete"` when done. On failure, `phase: "error"` is emitted for the failing step before the error is re-thrown.

| Workflow | Steps (PSBT listings) | Steps (Kontor listings) |
|----------|-----------------------|-------------------------|
| `openSellOrder` | `validateParams` → `requestSellQuote` → `signPrepPsbt`* → `finalizePrepPsbt`* → `signSwapPsbt` → `signFeePsbt`* → `createSwap` | `validateParams` → `reserveKontorFee` → `composeKontorOffer` → `createSwap` |
| `fillSwaps` | `validateParams` → `requestBuyQuote` → `signBuyerPsbt` → `submitPurchase` | `validateParams` → `inspectKontorOffer` → `acceptKontorOffer` → `submitPurchase` |
| `delistSwap` | `startDelist` → `signDelistMessage` → `confirmDelist` | `revokeKontorOffer` → `startDelist` → `signDelistMessage` → `confirmDelist` |

\* omitted when not applicable (no prep PSBT / no fee PSBT). For PSBT listings, `totalSteps` is `null` on the first `openSellOrder` events until the sell quote is received and the step plan is known; Kontor workflows know their step count up front.

## React UI (optional)

Import from `@unspendablelabs/horizon-market-client/react`. Bundlers pick the web or React Native build automatically (`react-native` condition on the `./react` export).

```tsx
import {
  HorizonMarketProvider,
  LoginPanel,
  SellOrderForm,
  SwapConfirmation,
  SwapList,
} from "@unspendablelabs/horizon-market-client/react";

function App() {
  return (
    <HorizonMarketProvider
      network="mainnet"
      ordApiBaseUrl="https://ord.example.com"
      theme={{ colors: { primary: "#3b82f6" } }}
    >
      <LoginPanel getPrivateKey={yourWeb3AuthGetPrivateKey} />
      <SwapList getPrivateKey={yourWeb3AuthGetPrivateKey} />
      <SellOrderForm onSuccess={(swap) => console.log(swap.id)} />
    </HorizonMarketProvider>
  );
}
```

| Export | Description |
|--------|-------------|
| `HorizonMarketProvider` | Context: client, addresses, `initialize` / `logout`, theme |
| `useHorizonMarket`, `useTheme` | Access provider state and resolved theme |
| `useLoginPanel`, `useAssets`, `useSellOrder`, `useSwapConfirmation`, `useSwapList` | Headless hooks (build your own UI) |
| `useBtcBalance`, `useWithdraw`, `usePrices`, `useFeeEstimates` | Headless wallet hooks (balances, withdraw flow, BTC/USD price, fee rates) |
| `LoginPanel` | Email + Web3Auth-style `getPrivateKey` flow |
| `SwapList` | Browse, filter, buy, and delist swaps (orchestrates login + confirmation modals) |
| `SellOrderForm` | Multi-step sell listing from the wallet's owned balances (pick asset, confirm, progress) |
| `SwapConfirmation` | Buy or delist a swap with progress UI |
| `WithdrawForm`, `WalletBalances`, `WalletBalanceSummary` | Wallet UI: send/withdraw any asset, full balances view, compact summary |
| `WorkflowProgress`, `Modal` | Standalone progress list and the shared overlay modal |
| `defaultTheme`, `resolveTheme` | Theme helpers (plus `themeToCssVars` / `webTokens` on web) |

On **web**, the provider injects theme CSS variables (`--hm-*`) and falls back to shadcn/ui tokens when present. On **React Native**, pass `styles` overrides per component.

## Quick Start

```ts
import { HorizonMarketClient } from "@unspendablelabs/horizon-market-client";

const client = new HorizonMarketClient({
  privateKey: "your-private-key-hex",
  network: "mainnet",
});

// --- Open a sell order (counterparty, existing UTXO) ---
const { swap, created } = await client.openSellOrder({
  assetUtxoId: "abc123...64hex...:0",
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  listingType: "counterparty",
});

// --- Open a sell order (counterparty, attach prep — no upfront UTXO needed) ---
const { swap: attachSwap } = await client.openSellOrder({
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  listingType: "counterparty",
});

// --- Open a sell order (ZELD transfer prep — mainnet only) ---
const { swap: zeldSwap, created: zeldCreated } = await client.openSellOrder({
  listingType: "zeld",
  assetName: "ZELD",
  assetQuantity: 100_000_000n,
  priceSats: 250_000,
  // No assetUtxoId — server composes prep_psbt; SDK finalizes → zeld_payment
});

// --- Buy ---
const sales = await client.fillSwaps({
  swapIds: ["swap_abc", "swap_def"],
  buyerAddress: "bc1q...",
  satsPerVbyte: 5,
  detach: true,
});

// --- Delist ---
await client.delistSwap("swap_abc");
```

## Kontor (KOR token + NFT)

Kontor assets use the same `openSellOrder` / `fillSwaps` / `delistSwap` methods — just
pass `listingType: "kontor"`. Unlike the PSBT asset types (where the server composes an
unsigned PSBT and the client signs it), Kontor atomic swaps are composed, signed, and
broadcast entirely client-side by the embedded `@kontor/sdk`. **Your private key never
leaves the client** — only signed transactions, the offer blob, and public addresses are
ever sent to the API.

Kontor is **signet-only** today, so construct the client with `network: "testnet"`
(signet shares testnet address params) and `kontorNetwork: "signet"`:

```ts
const client = new HorizonMarketClient({
  privateKey: "your-private-key-hex",
  network: "testnet",
  kontorNetwork: "signet",
});

// --- Sell KOR (fungible token) ---
const { swap } = await client.openSellOrder({
  listingType: "kontor",
  kontorAssetKind: "token",
  korAmount: "100.5",        // decimal string
  priceSats: 50_000,
});

// --- Sell a Kontor NFT ---
await client.openSellOrder({
  listingType: "kontor",
  kontorAssetKind: "nft",
  nftId: "my-nft-id",
  nftContractAddress: "nft@307992.5",
  priceSats: 250_000,
});

// --- Buy a Kontor swap (exactly one swapId) ---
await client.fillSwaps({ swapIds: ["swap_kontor_abc"] });

// --- Delist (revokes the on-chain offer, then BIP322-confirms) ---
await client.delistSwap("swap_kontor_abc");
```

**Funding UTXOs.** Kontor transactions are funded by your taproot UTXOs. By default the
client auto-fetches your confirmed taproot UTXOs from Horizon (only your public address is
sent). To supply them yourself — or use a dedicated funding address — pass `fundingUtxos`
on sell, `kontorFundingUtxos` on buy, or `fundingUtxos` in `delistSwap` options (a
`KontorUtxoInput[]` or a `() => Promise<KontorUtxoInput[]>` fetcher).

**Orphan protection.** Kontor transactions are broadcast on-chain *before* the
corresponding server-side record. If the recording POST fails after the broadcast,
the workflows throw marker errors so you can recover without re-broadcasting:

- `openSellOrder` → `KontorListingNotRecordedError` carrying `{ offerBlob, createRequest }` — retry the POST, or revoke to reclaim the escrowed asset
- `fillSwaps` → `KontorPurchaseNotRecordedError` carrying `{ swapId, txId, buyerAddress }` — the offer is consumed; retry only the recording
- `delistSwap` → `KontorDelistNotRecordedError` carrying `{ swapId }` — the revoke happened; re-run only `startDelist` → sign → `confirmDelist`

> Requires a `LocalSigner` (i.e. construct with `privateKey`). Custom signers must
> implement the optional `getKontorSigning(chain)` capability to support Kontor.

## Locked asset UTXOs

Before listing, check which `asset_utxo_id` values are already locked in active listings for your seller address(es). This avoids double-listing or picking UTXOs that collide with fee inputs.

```ts
const locked = await client.getLockedAssetUtxoIds({
  sellerAddress: "bc1q...",
});
// { "txid64hex...:0": true, "another...:1": true }

if (locked["my-txid:0"]) {
  // UTXO is already in an open listing — pick another or delist first
}
```

`GET /api/atomic-swaps/asset-utxo-id` reports locks only; it does not discover wallet UTXOs.

## API

### Constructor

```ts
new HorizonMarketClient({
  privateKey?: string | Uint8Array,  // hex, with or without 0x (single key backs both addresses)
  mnemonic?: string,                 // BIP39 phrase — derived via HDSigner.fromMnemonic (Horizon Wallet convention: BIP84 segwit + BIP86 taproot)
  mnemonicOptions?: { account?, passphrase? }, // BIP32 account index + BIP39 passphrase for `mnemonic`
  signer?: Signer,                   // custom signer (hardware wallet, etc.)
  network?: "mainnet" | "testnet",   // default: "mainnet"
  baseUrl?: string,                  // default: "https://horizon.market"
  fetch?: typeof globalThis.fetch,   // injectable fetch (for tests / custom runtimes)
  sessionToken?: string,             // reuse a NextAuth session cookie (fee credits) across processes
  bearerToken?: string,              // reuse a bearer token from signInWithWallet (cross-origin friendly)
  kontorNetwork?: "signet",          // enable Kontor ops (signet-only today; requires network: "testnet")
  kontorIndexerUrl?: string,         // default: public signet indexer; set for self-hosting / browser CORS
  kontorNftContractAddress?: string, // NFT contract to enumerate owned Kontor NFTs (no cross-contract query)
  counterpartyApiBaseUrl?: string,   // owned-balance reads; default: "https://api.counterparty.io:4000" (mainnet only)
  zeldApiBaseUrl?: string,           // ZELD balance reads (own protocol); default: "https://api.zeldhash.com" (mainnet only)
})
```

Signer precedence when several are given: `signer` > `privateKey` > `mnemonic`.

Note the two mnemonic paths derive **different** keys: the constructor `mnemonic`
option follows the Horizon Wallet convention (`HDSigner` — a BIP84 key for the
SegWit address, a BIP86 key for the Taproot address, `coin_type` per network),
while `LocalSigner.fromMnemonic` derives a **single** BIP86 key backing both
addresses (the web3auth model).

### Mnemonic & Keystore

Pure-JS helpers (no `node:crypto`, no WASM — usable in Node, the browser and
React Native with the `react-native-get-random-values` polyfill):

- `generateMnemonic(strength?)` — 128-bit (12 words) or 256-bit (24 words, default) BIP39 phrase
- `validateMnemonic(mnemonic)` — wordlist + checksum check
- `mnemonicToPrivateKey(mnemonic, { path?, passphrase? })` — derive a raw secp256k1 key (hex)
- `LocalSigner.fromMnemonic(mnemonic, { network?, path?, passphrase? })` — single-key signer (one BIP86 key backs both addresses — web3auth model; the SegWit address will **not** match a standard BIP84 wallet)
- `HDSigner.fromMnemonic(mnemonic, { network?, account?, passphrase? })` — Horizon-Wallet-compatible two-key signer (BIP84 segwit + BIP86 taproot, `coin_type` per network); this is what the client `mnemonic` option uses
- `deriveHorizonWalletKeys`, `horizonWalletPath`, `coinTypeForNetwork`, `privateKeyToMnemonic` — lower-level derivation helpers
- `DEFAULT_DERIVATION_PATH` — BIP86 `m/86'/0'/0'/0/0` (`coin_type` fixed to 0; network chosen at address time)
- `encryptKeystore(secret, password, opts?)` / `decryptKeystore(json, password)` — scrypt + AES-256-GCM keystore blobs (string → string; you own storage)

See `apps/cli` for an end-to-end integration (encrypted `0600` keystore file,
`init` / `list` / `balances` / `sell` / `buy` / `send`).

### Owned-Balance Reads

Read the connected wallet's real holdings (used by `SellOrderForm` / `useAssets`):

- `getCounterpartyBalances(addresses)` — XCP + Counterparty assets per address (mainnet; excludes ZELD)
- `getZeldBalances(addresses)` — ZELD balance per address from the ZeldHash API (its own protocol; mainnet only)
- `getKontorHoldings()` — KOR token balance + owned Kontor NFTs (signet; NFTs require `kontorNftContractAddress`)

### Send / Withdraw

Compose, sign, and broadcast a plain transfer of any supported asset type
(BTC / Counterparty / ZELD / ordinal / KOR / Kontor NFT) — used by the
`WithdrawForm` component and the CLI `send` command:

- `prepareSend(request, options?)` — compose + sign; returns a `PreparedSend` with the exact `feeSats` and a `broadcast()` method
- `send(request, options?)` — prepare + broadcast in one call, returns `{ txid }`
- Types: `SendRequest` (discriminated on `kind`), `SendResult`, `PreparedSend`; `options.protectedUtxoIds` keeps inscription UTXOs out of BTC funding

### Authentication & Credits (optional)

Wallet sign-in (BIP322) for platform-fee credits. Anonymous use works fine — these
only unlock fee waivers:

- `signInWithWallet(params)` — bearer-token sign-in (`WalletTokenSignIn`); pass the token back via the `bearerToken` option
- `signInWithWalletCookie(params)` — cookie-based variant for same-origin apps (see `sessionToken`)
- `getCredits()` — `CreditBalance | null` (`null` = signed out; throws on transient server errors)
- `getSession()` / `isAuthenticated()` / `signOut()` — session introspection and teardown

### Workflow Methods

- `openSellOrder(params, options?)` — quote → sign → submit sell listing; returns `{ swap, created, transactions }` (`transactions` = on-chain txs the listing broadcast)
- `fillSwaps(params, options?)` — quote → sign → submit purchase
- `delistSwap(swapId, options?)` — start → sign (BIP322) → confirm delist
- `previewKontorListingFee(address)` — side-effect-free Kontor listing-fee preview

### REST Helpers

All REST helpers accept an optional second argument `{ signal?: AbortSignal }` for request cancellation.

- `listSwaps(params?, options?)` — filter by `listingType`, `collection`, price range (`priceMin` / `priceMax`, sats), and more
- `getSwapFacets(params?, options?)` — reactive facet counts (type / price bucket / collection) for a filter set
- `getSwap(id, options?)`
- `getLockedAssetUtxoIds(params?, options?)`
- `searchAssetNames(params?, options?)`
- `getPendingPurchaseTxIds(swapId, address, options?)`
- `requestSellQuote(params, options?)`
- `requestBuyQuote(params, options?)`
- `requestFeeQuote(params, options?)`
- `createSwap(req, options?)`
- `purchaseSwaps(params, options?)`
- `startDelist(swapId, options?)`
- `confirmDelist(requestId, signature, options?)`

Example:

```ts
const controller = new AbortController();
const swaps = await client.listSwaps({ limit: 10 }, { signal: controller.signal });
```

## Notes

- **Private key security**: never share your private key; this SDK signs locally.
- **`price`** is the **net sats the seller receives**. Buyers pay `price + royalty`.
- **Quote expiry**: `fee_payment_id` expires in 30 minutes — sign and submit promptly (null when `feeWaived`).
- **ZELD listings**: mainnet only. Sell from an existing UTXO (`fee_payment`), or omit `assetUtxoId` for **transfer prep** (finalize `prep_psbt` → `zeld_payment` on create, or `funding_tx_hex` when fee is waived).
- **ZELD idempotency**: transfer-prep creates (`zeld_payment`) may return HTTP 200 with `created: false` on replay, or 409 on conflict. Do not blindly retry counterparty/ordinal creates.
- **Buyer address**: must be P2WPKH (`bc1q…` / `tb1q…`) for counterparty/zeld.
- **Ordinal buys**: provide `buyerTaprootAddress` (receives the inscription) plus P2WPKH `buyerAddress` (funds the purchase).
- **Prep listings**: attach-prep and zeld transfer-prep swaps may be `funded: false` until the prep tx confirms — poll `getSwap` before `fillSwaps`.

## License

MIT
