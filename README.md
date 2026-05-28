# @horizon-market/client

TypeScript client for the [Horizon Market](https://horizon.market) Atomic Swap API.

## Install

```bash
npm install @horizon-market/client
```

## Quick Start

```ts
import { HorizonMarketClient } from "@horizon-market/client";

const client = new HorizonMarketClient({
  privateKey: "your-private-key-hex",
  network: "mainnet",
});

// --- Open a sell order (xcp, existing UTXO) ---
const { swap, created } = await client.openSellOrder({
  assetUtxoId: "abc123...64hex...:0",
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  listingType: "xcp",
});

// --- Open a sell order (xcp, attach prep — no upfront UTXO needed) ---
const { swap: attachSwap } = await client.openSellOrder({
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  listingType: "xcp",
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

## API

### Constructor

```ts
new HorizonMarketClient({
  privateKey?: string | Uint8Array,  // hex, with or without 0x
  signer?: Signer,                   // custom signer (hardware wallet, etc.)
  network?: "mainnet" | "testnet",   // default: "mainnet"
  baseUrl?: string,                  // default: "https://horizon.market"
  fetch?: typeof globalThis.fetch,   // injectable fetch (for tests / custom runtimes)
})
```

### Workflow Methods

- `openSellOrder(params)` — quote → sign → submit sell listing
- `fillSwaps(params)` — quote → sign → submit purchase
- `delistSwap(swapId)` — start → sign (BIP322) → confirm delist

### REST Helpers

- `listSwaps(params?)`
- `getSwap(id)`
- `getLockedAssetUtxoIds(params?)`
- `searchAssetNames(params?)`
- `getPendingPurchaseTxIds(swapId, address)`
- `requestSellQuote(params)`
- `requestBuyQuote(params)`
- `requestFeeQuote(params)`
- `createSwap(req)`
- `purchaseSwaps(params)`
- `startDelist(swapId)`
- `confirmDelist(requestId, signature)`

## Notes

- **Private key security**: never share your private key; this SDK signs locally.
- **`price`** is the **net sats the seller receives**. Buyers pay `price + royalty`.
- **Quote expiry**: `fee_payment_id` expires in 30 minutes — sign and submit promptly.
- **ZELD listings**: mainnet only.
- **Buyer address**: must be P2WPKH (`bc1q…` / `tb1q…`) for xcp/zeld.
- **Ordinal buys**: provide `buyerTaprootAddress` (receives the inscription) plus P2WPKH `buyerAddress` (funds the purchase).

## License

MIT
