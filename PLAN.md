# Action Plan — Horizon Market Client (TypeScript)

Standalone TypeScript client for the [Horizon Market Atomic Swap API](https://horizon.market). Initialize with a private key locally and run full workflows (create listing, buy, delist) via **quote → sign → submit**.

**Primary references** (sibling repo — adjust paths locally):
- API spec: `../Horizon-Market/apiary.apib` (source of truth)
- Wire types / method shapes: `../Horizon-Market/src/modules/atomic-swap/lib/client.ts` (already aligned with apiary)
- Private-key PSBT signing: `../Horizon-Market/src/lib/wallets/web3auth/index.ts` (PSBT only — **not** `signMessage`, which is BIP137)
- ZELD idempotency: `../Horizon-Market/src/modules/atomic-swap/app/api/atomic-swaps/zeld-listing-idempotency.ts`
- Legacy client-side composition (optional / advanced only): `../Horizon-Market/src/modules/atomic-swap/lib/psbt/index.ts`

---

## Context and constraints

### Security model
The API **never** receives the private key. Write operations are authorized by:
- **Signed PSBTs** (seller swap, fee payment, buyer PSBT)
- **BIP322 message signature** (delist confirmation)

User session (email OTP / wallet challenge) is **optional** and out of scope for v1.

### Recommended client model (server-side composition)

The API **quote endpoints** compose every PSBT server-side. A standard SDK only needs:

1. An **HTTP client** (Horizon Market REST API)
2. A **local Bitcoin signer** (private key → sign PSBT inputs + BIP322 messages)

No Bitcoin indexer and no PSBT-composition library are required for the default path.

```
quote → sign → submit
```

| Step | Sell | Buy | Delist |
|---|---|---|---|
| Quote | `POST /api/atomic-swaps/sell-quotes` | `POST /api/atomic-swaps/buy-quotes` | — |
| Sign | `prep_psbt` (if present) + `swap_psbt` + `fee_psbt` (if present) — only indices in `*_inputs_to_sign` | `psbt` (buyer inputs only) | BIP322 on delist `id` (returned by start) |
| Submit | `POST /api/atomic-swaps` (+ `funding_tx_hex` / `reveal_tx_hex` and/or `fee_payment` / `zeld_payment` per quote) | `POST /api/atomic-swaps/purchases` | `PUT /api/atomic-swaps/delist-requests/{id}` |

A listing can require **up to three signed txs** (apiary *Workflows → Open a sell order*): **prep** (attach / zeld transfer, when needed), **fee** (platform fee PSBT for xcp/ordinal and zeld-from-existing-UTXO), **swap** (asset sale). The quote returns every unsigned PSBT; the client only signs.

### PSBT finalization matrix (critical)

| Artifact | Sign | Finalize before submit? | Wire field |
|---|---|---|---|
| `swap_psbt` | Seller inputs only | **No** — submit signed PSBT hex | `psbt_hex` on create |
| `fee_psbt` | Seller inputs only | **No** — server finalizes on broadcast | `fee_payment.psbt_hex` |
| `prep_psbt` (xcp attach) | Seller inputs only | **Yes** — raw tx hex of attach **commit** | `funding_tx_hex` (+ optional `reveal_tx_hex` unchanged from quote) |
| `prep_psbt` (zeld transfer) | Seller inputs only | **Yes** — raw tx hex + txid | `zeld_payment.zeld_send_tx_hex` / `zeld_send_txid` (Phase 7) |
| Buyer `psbt` | Buyer inputs only | **No** — server merges seller sigs and finalizes | `psbt_hex` on purchases |

Use `Psbt.extractTransaction().getId()` for `zeld_send_txid` (same as Horizon web `zeld-sell-flow`) — do not hand-roll hash reversal.

### Supported asset types
| `listing_type` | Quote / workflow notes |
|---|---|
| `xcp` | `sell-quotes` may return `prep_psbt` (`prep_kind: "attach"`) when the asset is not yet UTXO-attached; otherwise existing-UTXO path (`prep_psbt: null`). Buy: multi-swap, `detach` (default `true`), royalties in `buy-quotes`. |
| `ordinal` | Sell: existing inscription UTXO only (`asset_utxo_id` required). Buy: single `swap_id` + `buyer_taproot_address`; `royalty_sats: 0`. |
| `zeld` | **Mainnet only** (apiary). Buy: same as xcp. Sell **existing UTXO**: same as xcp (`fee_psbt` + `fee_payment`). Sell **transfer prep** (omit `asset_utxo_id`): `prep_psbt` + folded fee (`fee_psbt: null`, `payment_address` / `payment_amount`) → finalize prep → `zeld_payment` on create (**Phase 7** workflow). |

### Supported Bitcoin addresses
- **Seller**: P2WPKH (`bc1q…`) or P2TR (`bc1p…`) — `seller_pubkey` required for P2TR in `sell-quotes`
- **Buyer**: P2WPKH for xcp/zeld; P2WPKH + P2TR (`buyer_taproot_address`) for ordinals

### API conventions the SDK must surface

- **`price`** is the **net sats the seller receives**; buyer pays `price + royalty` (royalty grossed up). Document this — the web UI shows gross, the API stores net.
- **Quote expiry:** `fee_payment_id` from `sell-quotes` / `fee-quotes` expires **30 minutes**; stale create returns `400 Invalid OnChainPayment` — workflows should sign and submit promptly.
- **`expires_at`** on create is **optional** (omit = non-expiring listing); not part of `sell-quotes`.
- **ZELD listings:** `asset_name` must be `"ZELD"` on quotes and create.

### Sell paths (choose one per listing)

| Path | `sell-quotes` input | Quote returns | Create submits |
|---|---|---|---|
| **Existing asset UTXO** | `asset_utxo_id` + `asset_name` + `asset_quantity` (xcp/zeld) | `prep_psbt: null`, `swap_psbt`, `fee_psbt`, derived `asset_utxo_id` / `asset_utxo_value` | signed swap + `fee_payment`; use quote’s `asset_utxo_*` on create |
| **Compose prep (xcp attach)** | omit `asset_utxo_id`; `asset_name` + `asset_quantity` | `prep_psbt`, optional `reveal_tx_hex`, swap + fee PSBTs; `asset_utxo_id` = reveal vout `0` when reveal present | signed prep as `funding_tx_hex`, optional `reveal_tx_hex`, swap + `fee_payment` |
| **Compose prep (zeld transfer)** | omit `asset_utxo_id`; `asset_name: "ZELD"` + `asset_quantity` | `prep_psbt`, `fee_psbt: null`, `payment_*` | finalize signed `prep_psbt` → `zeld_payment` (**Phase 7**) |

### What the client must still supply (not composed by quotes)

- **Existing-UTXO sells:** `asset_utxo_id` (wallet / indexer) — format **`{64-char-txid}:{vout}`**. **`GET /api/atomic-swaps/asset-utxo-id`** lists UTXOs locked in active listings (avoid double-list / fee-input collisions) — **not** asset discovery.
- **Attach / transfer-prep sells:** no upfront `asset_utxo_id`; quote derives it — pass `asset_name` + `asset_quantity` to `sell-quotes` only.
- **Create metadata:** `expires_at?`, `asset_name`, `asset_quantity` (must match quote for xcp/zeld), `asset_utxo_id` / `asset_utxo_value` from **quote response** (critical for attach/reveal).

### Advanced path (optional, out of v1 scope)

The spec still allows composing PSBTs yourself (`fee-quotes` + manual swap PSBT, or `GET /atomic-swaps/{id}` + manual buyer PSBT). The SDK may expose this later as `advanced.*` helpers ported from `atomic-swap/lib/psbt/`, but it is **not** the default.

---

## Target architecture

```
@horizon-market/client
├── src/
│   ├── client.ts              # HorizonMarketClient — entry point
│   ├── config.ts              # baseUrl, network
│   ├── api/                   # REST HTTP layer (apiary.apib)
│   │   ├── http.ts
│   │   ├── atomic-swaps.ts    # list, get, create, asset-name search, locked UTXOs, pending sales
│   │   ├── sell-quotes.ts
│   │   ├── buy-quotes.ts
│   │   ├── fee-quotes.ts      # advanced only
│   │   ├── purchases.ts
│   │   └── delist.ts
│   ├── types/                 # Types derived from spec
│   ├── crypto/
│   │   ├── signer.ts          # Local signer (private key → addresses)
│   │   ├── psbt-signer.ts     # signPsbt (P2WPKH + P2TR)
│   │   └── bip322.ts          # signMessage for delist
│   └── workflows/
│       ├── sell.ts            # openSellOrder()  — sell-quotes → sign → create
│       ├── buy.ts             # fillSwaps()      — buy-quotes → sign → purchase
│       └── delist.ts          # delistSwap()     — start → sign → confirm
```

**Principle:** thin HTTP layer + crypto signer + thin workflow orchestration. **No** `psbt/` composition module and **no** `bitcoin/` indexer module in the default build.

**Naming:** public SDK methods and **exported domain types** use **camelCase**; wire JSON uses **snake_case** per `apiary.apib`. Keep two type layers:
- `src/types/api/` — wire shapes (snake_case, mirrors `apiary.apib`)
- `src/types/` — exported domain types (camelCase)

The `api/` module maps between them. Workflows and `HorizonMarketClient` accept/return domain types only — never snake_case in public signatures.

**Network:** `network: "mainnet" | "testnet"` drives address derivation and PSBT network params. `baseUrl` defaults to `https://horizon.market` — **origin only, no `/api` suffix**; HTTP methods use paths like `/api/atomic-swaps/…` (same host for both networks today; keys/addresses must match the deployment’s `NEXT_PUBLIC_NETWORK`).

**Signer abstraction:** `HorizonMarketClient` accepts `privateKey` by default but should also accept an optional `Signer` interface (`getAddresses`, `signPsbtHex`, `signMessage`) so hardware / external wallets can be wired in later without API churn.

**Public surface (`src/index.ts`):** export `HorizonMarketClient`, `HorizonMarketApiError`, `Signer`, `LocalSigner`, and domain types. Expose **both** workflows and thin REST helpers on the client (e.g. `client.listSwaps()`, `client.requestSellQuote()`, `client.createSwap()`) so integrators can run quote → sign → submit manually or via `openSellOrder` / `fillSwaps` / `delistSwap`.

**HTTP success codes:** treat **200 and 201** as success only where the spec allows both — today that is **`createSwap`** (201 new listing, 200 ZELD idempotent replay). All other v1 write endpoints return a single success code (**201** for delist start/confirm, **200** for quotes/purchases). **409** and other non-2xx are errors. The HTTP layer must expose the status code on `createSwap` so workflows can set `created: boolean`.

---

## Phase 0 — Analysis and scoping (0.5–1 day)

### Goals
Confirm v1 scope against the updated spec and verify routes are live.

### Tasks
- [ ] **Verify quote endpoints** are deployed and match `apiary.apib`:
  - `POST /api/atomic-swaps/sell-quotes`
  - `POST /api/atomic-swaps/buy-quotes`
- [ ] **Smoke-test quote → sign → submit** manually (curl + test key) for xcp sell + buy on testnet/staging
- [ ] **Map all v1 endpoints** (see Phase 2 table); note legacy shims (`/multi-buy`, `/on-chain-payment`) are **not** used by the SDK
- [ ] **Confirm response shape** — all 2xx responses wrap payload in `{ data }` (apiary examples and live server both use this envelope via `newResponseData`)
- [ ] **Confirm request shape per endpoint** — the public REST surface uses **flat snake_case bodies** for quotes, create, purchases, and delist confirm; legacy `{ data: … }` wrapping is accepted on quote/create routes but must **not** be the SDK default
- [ ] **Define v1 scope**:
  - ✅ xcp + ordinal: sell (existing UTXO **and** attach prep), buy, delist
  - ✅ xcp sell without `asset_utxo_id` (server-composed attach prep + optional reveal)
  - ✅ Read helpers: `listSwaps` (incl. `unattached`), `getLockedAssetUtxoIds`, `searchAssetNames`, `getPendingPurchaseTxIds`
  - ✅ ZELD **buy** + ZELD **sell from existing UTXO** (`fee_psbt` path, same as xcp)
  - ⚠️ ZELD **sell transfer prep** (finalize `prep_psbt` → `zeld_payment`) — Phase 7
  - ❌ Advanced self-composed PSBT path (`fee-quotes` + manual swap PSBT)
  - ❌ Session / credits / subscription (fee waiver)
- [ ] **List signer dependencies** to port from Web3Auth (PSBT only) + add for delist (pin same majors as Horizon Market):
  - `bitcoinjs-lib` (`^7.0.0-rc.0`), `@bitcoinerlab/secp256k1` (`^1.1.1`), `ecpair` (`^2.1.0`) — PSBT signing (from Web3Auth)
  - `bip322-js` (`^3.0.0`) — BIP322 message signing for delist via `Signer.sign(privateKeyHex, address, message)` → base64; server verifies with `Verifier.verifySignature` (do **not** use `bitcoinjs-message` / BIP137)

### Deliverables
- Endpoint smoke-test notes
- Signed-off v1 scope

---

## Phase 1 — Package scaffolding (1 day)

### Goals
Create a publishable npm package usable in Node.js and bundlers (ESM + CJS).

### Tasks
- [ ] Initialize the `Horizon-Market-Client` repo:
  ```json
  {
    "name": "@horizon-market/client",
    "type": "module",
    "sideEffects": false,
    "engines": { "node": ">=20" },
    "publishConfig": { "access": "public" },
    "exports": {
      ".": {
        "import": {
          "types": "./dist/index.d.ts",
          "default": "./dist/index.js"
        },
        "require": {
          "types": "./dist/index.d.cts",
          "default": "./dist/index.cjs"
        }
      }
    },
    "types": "./dist/index.d.ts",
    "files": ["dist", "README.md", "LICENSE"]
  }
  ```
- [ ] Configure **TypeScript** (`strict: true`, `verbatimModuleSyntax: true`, `declaration: true`) + **tsup** (`format: ["esm", "cjs"]`, `dts: true`, `splitting: false`, `sourcemap: true`) for dual ESM/CJS + `.d.ts` (prefer over unbuild — simpler for libraries). Use `module`/`moduleResolution: "NodeNext"` in `tsconfig.json` (idiomatic for publishable Node libs); let tsup emit the dual package — avoid `"bundler"` resolution in the published type graph.
- [ ] Configure **Vitest** for unit tests (Node-compatible, no DOM) + devDependency `@types/node`
- [ ] Configure **ESLint** + **Prettier**
- [ ] Add `.gitignore`, minimal `README.md`, `LICENSE`
- [ ] GitHub Actions CI: `typecheck`, `test`, `build`

### Deliverables
- Package that compiles and exports a stub `HorizonMarketClient`
- Green CI pipeline on stub

---

## Phase 2 — HTTP layer and types (2 days)

### Goals
Implement a typed REST client conforming to `apiary.apib`.

### Endpoints to cover (v1)

| Method | Path | Usage |
|---|---|---|
| `GET` | `/api/atomic-swaps` | List / filter swaps |
| `GET` | `/api/atomic-swaps/asset-utxo-id` | Locked asset UTXO ids for seller address(es) |
| `GET` | `/api/atomic-swaps/asset-name` | Search distinct listed asset names (+ `asset_media`) |
| `GET` | `/api/atomic-swaps/{id}` | Swap detail |
| `GET` | `/api/atomic-swaps/{id}/pending-sales/{address}` | Poll in-flight purchase tx ids after `purchases` |
| `POST` | `/api/atomic-swaps/sell-quotes` | **Compose** sell PSBTs (default sell path) |
| `POST` | `/api/atomic-swaps/buy-quotes` | **Compose** buy PSBT (default buy path) |
| `POST` | `/api/atomic-swaps` | Submit signed listing |
| `POST` | `/api/atomic-swaps/purchases` | Submit signed purchase |
| `POST` | `/api/atomic-swaps/{id}/delist-requests` | Start delist |
| `PUT` | `/api/atomic-swaps/delist-requests/{request_id}` | Confirm delist (BIP322) |
| `POST` | `/api/atomic-swaps/fee-quotes` | Advanced only — optional export |

### Types to define

**Resources (domain / camelCase exports):** `AtomicSwap`, `ListingType`, `PrepKind`, `Pagination`, `ListSwapsResult`, `LockedAssetUtxoIds`, `AssetNameSearchResult`, `PendingSale`, `OnChainPayment`, `DelistRequest`, `SellQuote`, `BuyQuote`, `FeeQuoteBtc`, `FeeQuoteZeldTransferPrep`, `AtomicSwapCreateRequest`, `CreateSwapResult`, `ConfirmDelistResult`, `FeePayment`, `ZeldPayment`

**`AtomicSwap`** — mirror `apiary.apib` Data Structures (`listingType`, `sellerAddress`, `buyerAddress`, `assetUtxoId`, `assetUtxoValue`, `assetName`, `assetQuantity`, `price`, `pricePerUnit`, `psbtHex`, `txId`, `blockIndex`, `funded`, `filled`, `confirmed`, `delisted`, `sellerDelisted`, `expired`, `pending`, `anomalous`, `royalty`, `expiresAt`, `createdAt`, `updatedAt`, `onChainPayment`, optional `user`). Parse `assetQuantity` from JSON as `bigint` when present (wire may be `number` or `string` for large values). **`sellerDelisted`** is required on the wire — do not omit from the domain type. Timestamps (`expiresAt`, `createdAt`, `updatedAt`) stay **ISO 8601 strings** in domain types (wire format); only workflow **inputs** like `openSellOrder({ expiresAt: Date })` accept `Date` and serialize to RFC 3339 UTC on create.

**State flags (document in README / JSDoc):** `funded` = seller asset UTXO confirmed on-chain; `confirmed` = platform fee tx confirmed; `pending` = buy tx in mempool; `anomalous` = not purchasable. A newly created attach/zeld-prep listing may be `funded: false` until prep confirms — poll `getSwap` before `fillSwaps`.

**`OnChainPayment` (domain):**
```typescript
interface OnChainPayment {
  id: string;
  confirmed: boolean;
  txid: string | null;
  /** Present in live responses; not listed in apiary but safe to parse. */
  sats?: number;
  toAddress?: string;
}
```

**`ListSwapsResult`:** `{ count: number; atomicSwaps: AtomicSwap[]; assetMedia: Record<string, unknown>; pagination: Pagination }` — `count` mirrors `pagination.total`; map from wire `asset_media`. The live API returns **only** `asset_media` (snake_case); defensively ignore a stray `assetMedia` key if ever present, but do not expect it from current routes.

**`AssetNameSearchResult`:** `{ assetNames: string[]; assetMedia: Record<string, unknown> }`.

**`PrepKind`:** `"attach" | "zeld_transfer" | null`.

**`LockedAssetUtxoIds`:** `Record<string, true>` — keys are locked `asset_utxo_id` strings (`txid:vout`); empty object = none locked.

**`PendingSale`:** `{ txId: string; buyerAddress: string; atomicSwap: { id: string } }`

**`DelistRequest` (domain):**
```typescript
interface DelistRequest {
  id: string; // BIP322-sign this exact string, then PUT …/delist-requests/{id}
  atomicSwap: { id: string; sellerAddress: string };
}
```

**Quote responses (domain)** — mirror `SellQuoteResponse` / `BuyQuoteResponse` in `Horizon-Market/.../client.ts`:
```typescript
interface SellQuote {
  swapPsbt: string;
  swapInputsToSign: number[];
  feePsbt: string | null;
  feeInputsToSign: number[];
  feePaymentId: string;
  assetUtxoId: string;       // from quote — use on create (reveal txid when attach+reveal)
  assetUtxoValue: number;    // from quote — use on create
  prepPsbt: string | null;
  prepInputsToSign: number[];
  prepKind: PrepKind;
  revealTxHex?: string;      // attach: pass unchanged on create
  paymentAddress?: string;   // zeld transfer prep only
  paymentAmount?: number;    // zeld transfer prep only
}

interface BuyQuote {
  psbt: string;
  inputsToSign: number[];
  feeEstimateSats: number;
  royaltySats: number;
  royaltyAddress: string | null;
}

interface FeeQuoteBtc {
  feePaymentId: string;
  psbt: string;              // fee-quotes uses `psbt`, not `swap_psbt`
  rawTransaction: string;
  inputsToSign: number[];
}

interface FeeQuoteZeldTransferPrep {
  feePaymentId: string;
  paymentAddress: string;
  paymentAmount: number;
}

interface FeePayment { psbtHex: string; feePaymentId: string }
interface ZeldPayment { zeldSendTxid: string; zeldSendTxHex: string; feePaymentId: string }

interface AtomicSwapCreateRequest {
  assetUtxoId: string;
  assetUtxoValue: number;
  assetName?: string | null;
  assetQuantity?: bigint | number | null;
  price: number;
  sellerAddress: string;
  psbtHex: string;
  listingType?: ListingType;
  expiresAt?: string | null;  // RFC 3339 UTC; omit = no expiry
  feePayment?: FeePayment;
  zeldPayment?: ZeldPayment;   // Phase 7
  fundingTxHex?: string;       // signed attach commit (xcp prep)
  revealTxHex?: string;        // from quote when attach+reveal
}

/** HTTP layer return — status required for ZELD idempotency. */
interface CreateSwapResult {
  swap: AtomicSwap;
  status: 200 | 201;
}

interface ConfirmDelistResult {
  id: string;
  signature: string;
}

/** Wire Pagination — `limit` is null when the request omitted `limit`. */
interface Pagination {
  total: number;
  offset: number;
  limit: number | null;
}
```

### Request params (v1)

**`listSwaps` query (all optional):** `assetName`, `search`, `sellerAddress`, `buyerAddress`, `listingType`, `funded`, `filled`, `delisted`, `unattached`, `sales`, `order` (`asc`|`desc`), `orderBy` (`created_at`|`updated_at`|`price`|`price_per_unit`), `offset`, `limit`. Defaults per apiary: `delisted=false`, `unattached=false`, `sales=false`, `funded=!sales`, `order=desc`, `orderBy=created_at`. When `unattached=false` (default), only swaps with a non-null `asset_name` are returned. Serialize boolean query params as the strings `"true"` / `"false"` when present (match `atomic-swap/lib/client.ts`); omit unset params so server defaults apply.

**`getLockedAssetUtxoIds` query:** `sellerAddress?` and/or `sellerAddresses?` (comma-separated). Returns `{ [assetUtxoId]: true }`.

**`searchAssetNames` query:** `query?` (not `search` — distinct from `listSwaps`), `filled?` (default `false`), `limit?`.

**`getPendingPurchaseTxIds`:** path params `id`, `address` — returns `string[]` (tx ids).

**`requestFeeQuote` body (advanced, optional export):**
- **BTC fee PSBT:** `{ address, utxo_set_ids, sats_per_vbyte }` — note **`utxo_set_ids`** here (not `fee_utxo_ids` as on `sell-quotes`)
- **ZELD transfer-prep fee output:** `{ type: "zeld", address }` — response has `paymentAddress` / `paymentAmount` only (no PSBT)

**`requestSellQuote` body:** `price`, `seller_address`, `listing_type?` (**server default `"xcp"`** when omitted — SDK should pass explicitly from `openSellOrder.listingType`), `seller_pubkey?` (required for P2TR), `sats_per_vbyte?`, `fee_utxo_ids?` | `auto_select_fee_utxos?` (mutually exclusive). On the wire, `asset_quantity` may be `number` or `string` (match `SellQuoteRequest` in `client.ts`). Asset identification — **one of:**
- **Existing UTXO:** `asset_utxo_id` + `asset_name` + `asset_quantity` (required for xcp/zeld; ordinal: `asset_utxo_id` required, **`asset_name` optional**, **`asset_quantity` omitted**)
- **Compose prep:** omit `asset_utxo_id`; `asset_name` + `asset_quantity` (xcp attach or zeld transfer)

**`requestBuyQuote` body:** `swap_ids`, `buyer_address` (P2WPKH), `buyer_taproot_address?` (required for ordinals), `sats_per_vbyte?`, `funding_utxo_ids?` | `auto_select?` (mutually exclusive), `detach?` (default `true`, xcp only; ignored for zeld). Ordinal: **single** `swap_id` only. All `swap_ids` must reference the **same asset** (server `400` otherwise). Expect `400` when a swap is not yet purchasable (`funded: false`, `anomalous: true`, already `filled`, etc.) or `404` when delisted / unavailable.

**`createSwap` body:** see `AtomicSwapCreateRequest` — always use `asset_utxo_id` / `asset_utxo_value` from the quote; add `fee_payment` and/or `funding_tx_hex` / `reveal_tx_hex` per quote shape. For **`ordinal`**, `asset_quantity` may be omitted/null on create (inscription UTXO is the asset). For **`zeld`**, `asset_name: "ZELD"` and `asset_quantity` are **required**.

**`purchaseSwaps` body:** `swap_ids`, `buyer_address`, `psbt_hex`.

**Delist:** `POST …/{id}/delist-requests` with `{}`; `PUT …/delist-requests/{id}` with `{ signature }`.

### HTTP status codes (accept all documented + observed)

| Endpoint | Success | Notes |
|---|---|---|
| `GET` list / detail | 200 | `{ data: … }` |
| `POST sell-quotes` / `buy-quotes` / `fee-quotes` | 200 | |
| `POST /api/atomic-swaps` | **201** | new listing (apiary + server) |
| `POST /api/atomic-swaps` (zeld idempotent) | **200** / **409** | same seller UTXO + identical `psbt_hex` / `price` / `asset_quantity` → 200; conflicting open listing → 409 |
| `POST purchases` | 200 | `{ data: PendingSale[] }` |
| `POST delist start` | **201** | |
| `PUT delist confirm` | **201** | `{ data: { id, signature } }` |

### `HorizonMarketApiError` (exported)

```typescript
class HorizonMarketApiError extends Error {
  readonly status: number;
  readonly error: string; // server `{ error }` body
  constructor(status: number, error: string);
}
```

Map all non-2xx JSON `{ error: string }` responses to this type. Do not retry writes (`create`, `purchases`) on transport failure; reads (`listSwaps`, `getSwap`, …) may retry at caller discretion.

### Tasks
- [ ] Create generic `HttpClient` (`baseUrl`, native `fetch`, optional `AbortSignal`, `Content-Type: application/json` on bodies, unwrap `{ data }` on 2xx, throw `HorizonMarketApiError` on `{ error }`)
- [ ] Implement per-endpoint request serializers (public flat snake_case — see table below)
- [ ] Implement API methods: `listSwaps`, `getLockedAssetUtxoIds`, `searchAssetNames`, `getSwap`, `getPendingPurchaseTxIds`, `requestSellQuote`, `requestBuyQuote`, `requestFeeQuote` (advanced, optional export — return type is a **discriminated union**: `FeeQuoteBtc` when `psbt` is present, `FeeQuoteZeldTransferPrep` when `paymentAddress` is present), `createSwap` → **`CreateSwapResult`** (preserve HTTP status), `purchaseSwaps`, `startDelist`, `confirmDelist` → **`ConfirmDelistResult`**
- [ ] Optional injectable `fetch` (defaults to global `fetch`) for tests and custom runtimes
- [ ] Tests with mock `fetch` + fixtures from `apiary.apib` examples

### Request body conventions (match server shims)

| Endpoint | SDK sends (snake_case, flat) |
|---|---|
| `POST sell-quotes` / `buy-quotes` / `fee-quotes` | Flat body; server also accepts `{ data: … }` but SDK must not wrap |
| `POST /api/atomic-swaps` | Flat swap fields + optional `fee_payment`, `funding_tx_hex`, `reveal_tx_hex`, `zeld_payment` (server re-wraps legacy `{ data, payment }` internally) |
| `POST /api/atomic-swaps/purchases` | `{ swap_ids, buyer_address, psbt_hex }` — flat, no wrapper |
| `POST …/delist-requests` | `{}` — swap id comes from URL path |
| `PUT …/delist-requests/{id}` | `{ signature }` — flat, no wrapper |

### Watchouts
- **Attach + reveal:** when `reveal_tx_hex` is set, `asset_utxo_id` on quote/create is `{reveal_txid}:0`; `funding_tx_hex` is the signed **attach commit** from `prep_psbt` — do not swap commit/reveal txids
- **Prep before purchasable:** swaps with a prep/fee tx stay `funded: false` / `confirmed: false` until on-chain confirmation
- `asset_utxo_id` must match `{64-hex-txid}:{vout}` when provided — validated server-side
- `asset_quantity` as `bigint` in domain; serialize on create as a JSON **number** when `<= Number.MAX_SAFE_INTEGER`, otherwise as a JSON **string** (or reject with a clear error) — `JSON.stringify` cannot serialize `bigint` natively
- `GET /api/atomic-swaps/{id}` 404 message is `"Atomic swap not found"` (no swap id suffix)
- `POST /api/atomic-swaps/purchases` is **not** idempotent (apiary Conventions) — do not retry blindly on network errors
- **ZELD:** reject `openSellOrder` on testnet; `asset_name` must be `"ZELD"`
- **`fee_payment_id`:** 30-minute validity window after quote
- List response: map from `asset_media` only (see `ListSwapsResult` note)
- **Addresses:** seller must be P2WPKH or P2TR; buyer funding address must be **P2WPKH** (`bc1q…` / `tb1q…`)
- **Swap / fee PSBTs on create:** submit **signed PSBT hex**, not finalized raw txs — the server finalizes `fee_psbt` when broadcasting (`with-on-chain-payment.ts`)
- Buy quote: callers must **not reorder PSBT inputs** before signing (detach OP_RETURN is keyed on input 0)
- Sell quote: pass `seller_pubkey` when seller address is P2TR — **32-byte x-only hex** preferred (33-byte compressed also accepted — server strips to x-only)
- Funding/fee UTXO selection: when neither explicit ids nor `auto_select_*=true` is sent, server **auto-selects** anyway; explicit ids always win; flags are only needed to document intent or disambiguate docs
- **Attach prep + explicit `fee_utxo_ids`:** those UTXOs fund **both** the attach tx and (after excluding attach inputs) the separate fee PSBT — provide enough BTC or omit ids for auto-select (apiary *Sell quotes*)
- Mutually exclusive params: `auto_select_fee_utxos` vs `fee_utxo_ids`, `auto_select` vs `funding_utxo_ids` → **400**
- `AtomicSwap.anomalous === true` → swap is not purchasable; surface in `getSwap` / list docs
- Delist start on unknown swap → **400** (`AtomicSwap with id … not found`), not 404
- Buy/delist/purchase 404 messages: `"Atomic swap not found: …"`, `"Delisted swaps can only be purchased by seller"`, `"Asset no longer available for purchase: …"` — delisted swaps remain fillable by the **seller address** only (same asset rules apply)
- Pin `bitcoinjs-lib` to the same major as Horizon Market (`^7.0.0-rc.0`) for PSBT compatibility
- **`POST /api/atomic-swaps` is not idempotent** for `xcp` / `ordinal` — do not auto-retry create on network blips (only ZELD has 200/409 idempotency semantics)
- **`HttpClient` `baseUrl`** is the site origin (`https://horizon.market`); endpoint paths always include the `/api` prefix

### Deliverables
- Tested `api/` module (no crypto dependency)
- Exported types

---

## Phase 3 — Crypto module: local signer (2–3 days)

### Goals
Sign server-composed PSBTs and BIP322 delist messages from a private key at initialization.

### Proposed interface

```typescript
interface HorizonMarketClientOptions {
  privateKey?: string | Uint8Array;  // hex, with or without 0x — omit when passing `signer`
  signer?: Signer;
  network?: "mainnet" | "testnet";
  baseUrl?: string;  // default https://horizon.market
}

interface Signer {
  getAddresses(): { p2wpkh: string; p2tr?: string; publicKey: string; xOnlyPubkey?: string };
  signPsbtHex(psbtHex: string, inputIndices: number[], address?: string): string;
  signMessage(address: string, message: string): string; // BIP322 for delist
}

class LocalSigner implements Signer { /* … */ }
```

### Tasks — PSBT signing (ref. `web3auth/index.ts`)

- [ ] Initialize `bitcoinjs-lib` with `@bitcoinerlab/secp256k1`
- [ ] Derive P2WPKH + P2TR key-path addresses from private key
- [ ] Implement `signPsbt` on parsed `Psbt`:
  - Detect Taproot via `input.tapInternalKey` → `createTaprootSigner`
  - `allowedSighashTypes`: `SIGHASH_DEFAULT`, `SIGHASH_ALL`, `SIGHASH_NONE`, `SIGHASH_SINGLE | SIGHASH_ANYONECANPAY`
  - **Never modify** input order, outputs, or per-input `sighashType` set by the server
  - Sign **only** indices returned by `*_inputs_to_sign` / `inputs_to_sign`
- [ ] Return signed PSBT as hex (no finalization — server finalizes on purchase)

### Tasks — Message signing (delist)

- [ ] **BIP322 via `bip322-js` `Signer.sign(privateKey, address, message)`** — `privateKey` is a **hex string** (no `0x`); server verifies with `Verifier.verifySignature(address, message, signature)` (see `delist/route.ts`). Signature is base64 on the wire. Call `btc.initEccLib(ecc)` once before any PSBT/BIP322 use; `bip322-js` bundles its own `bitcoinjs-lib` — keep versions aligned with Horizon Market to avoid ECC double-init issues in tests.
- [ ] Do **not** port Web3Auth `signMessage` — it uses BIP137 (`bitcoinjs-message`) and will fail delist verification
- [ ] Unit tests: sign fixture PSBT; sign delist `id` and verify round-trip with `Verifier.verifySignature`

### Deliverables
- Standalone, tested `crypto/` module (P2WPKH + P2TR)

---

## Phase 4 — High-level workflows (2.5–3 days)

### Goals
Expose `HorizonMarketClient` methods that chain quote → sign → submit.

### `HorizonMarketClient`

```typescript
const client = new HorizonMarketClient({
  privateKey: "...",
  network: "mainnet",
});

// --- Sell xcp (existing UTXO) — assetUtxoId/value from wallet; quote may still refresh assetUtxo* ---
await client.openSellOrder({
  assetUtxoId: "abc123…64hex…:0",
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  sellerAddress: "bc1q…",
  listingType: "xcp",
  expiresAt: new Date("2026-06-01"), // optional
  satsPerVbyte: 5,
  // optional fee-input selection (mutually exclusive):
  // feeUtxoIds: ["btc-txid:0"],
  // autoSelectFeeUtxos: true,
});

// --- Sell xcp (attach prep — no asset_utxo_id upfront) ---
await client.openSellOrder({
  assetName: "RAREPEPE",
  assetQuantity: 1n,
  priceSats: 250_000,
  sellerAddress: "bc1q…",
  listingType: "xcp",
});

// --- Sell ordinal (existing inscription UTXO) ---
await client.openSellOrder({
  assetUtxoId: "abc123…:0",
  priceSats: 250_000,
  sellerAddress: "bc1p…",
  listingType: "ordinal",
  assetName: "optional-display-name",
});

// --- Sell zeld (existing UTXO — v1, same PSBT path as xcp) ---
await client.openSellOrder({
  assetUtxoId: "fedcba…:0",
  assetName: "ZELD",
  assetQuantity: 100_000_000n,
  priceSats: 250_000,
  sellerAddress: "bc1q…",
  listingType: "zeld",
});

// --- Buy (xcp / zeld) ---
await client.fillSwaps({
  swapIds: ["swap_abc", "swap_def"],
  buyerAddress: "bc1q…",
  satsPerVbyte: 5,
  detach: true,                 // xcp only; default true
  autoSelect: true,             // or fundingUtxoIds: ["…"]
});

// --- Buy ordinal (exactly one swap_id) ---
await client.fillSwaps({
  swapIds: ["swap_abc"],
  buyerAddress: "bc1q…",        // P2WPKH — funds the purchase
  buyerTaprootAddress: "bc1p…", // receives the inscription
});

// --- Delist ---
await client.delistSwap("swap_abc");
```

**Workflow return types (public API):**
- `openSellOrder` → `{ swap: AtomicSwap; created: boolean }` — `created: true` on **201**, `created: false` when ZELD idempotency returns **200** with an existing open listing; throw **`409`** `Conflicting zeld listing` when params differ (`psbt_hex`, `price`, `asset_quantity` must match per server — see `zeld-listing-idempotency.ts`)
- `fillSwaps` → `PendingSale[]`
- `delistSwap` → `void` (or minimal `{ id: string }` if you want the confirmed request id — not required for callers)

Serialize `expiresAt?: Date` to RFC 3339 UTC (`toISOString()`) on create.

### Workflow: `openSellOrder`

1. `POST sell-quotes` with listing params (+ `seller_pubkey` if P2TR)
2. If `prep_psbt` is not null: `signPsbtHex(prep_psbt, prep_inputs_to_sign)` → **`finalizeAllInputs()`** → `extractTransaction().toHex()` (and `.getId()` for zeld) — xcp attach → `funding_tx_hex`; zeld transfer → Phase 7 → `zeld_payment` (never `funding_tx_hex`)
3. `signPsbtHex(swap_psbt, swap_inputs_to_sign)` → submit as **PSBT hex** (do not finalize)
4. If `fee_psbt` is not null: `signPsbtHex(fee_psbt, fee_inputs_to_sign)` → submit as **PSBT hex** in `fee_payment` (do not finalize)
5. `POST /api/atomic-swaps` using **quote-derived** `asset_utxo_id` / `asset_utxo_value`, signed `psbt_hex`, and:
   - `fee_payment` when `fee_psbt` was signed (xcp, ordinal, zeld-existing-UTXO)
   - `funding_tx_hex` (+ `reveal_tx_hex` if quote returned it) for xcp attach prep
   - `zeld_payment` for zeld transfer prep (Phase 7)
6. Return created `AtomicSwap` (handle **201**; for `listing_type: "zeld"` also **200** / **409** per apiary idempotency)

### Workflow: `fillSwaps`

1. `POST buy-quotes` with `swap_ids`, `buyer_address`, optional `buyer_taproot_address`, funding options
2. `signPsbtHex(psbt, inputs_to_sign)` — **preserve input order**
3. `POST /api/atomic-swaps/purchases`

### Workflow: `delistSwap`

1. `POST /api/atomic-swaps/{id}/delist-requests` → `{ data: DelistRequest }` (201)
2. `signMessage(delistRequest.atomicSwap.sellerAddress, delistRequest.id)` — BIP322 on the **`id` string** (path segment `{request_id}` = this same `id`)
3. `PUT /api/atomic-swaps/delist-requests/{delistRequest.id}` with `{ signature }`

**`openSellOrder` input (domain, all optional unless noted):** `assetUtxoId?`, `assetName?`, `assetQuantity?`, `priceSats`, `sellerAddress?`, `listingType`, `expiresAt?`, `satsPerVbyte?`, `feeUtxoIds?` | `autoSelectFeeUtxos?` (mutually exclusive — forwarded to `sell-quotes`). Omit `assetUtxoId` for xcp attach prep (v1) or zeld transfer prep (Phase 7).

**`fillSwaps` input:** `swapIds`, `buyerAddress?`, `buyerTaprootAddress?` (ordinals), `satsPerVbyte?`, `fundingUtxoIds?` | `autoSelect?` (mutually exclusive), `detach?` (xcp only; default `true`; ignored for zeld).

### Cross-cutting tasks
- [ ] Derive `seller_address` / `buyer_address` from signer when omitted
- [ ] Auto-fill `seller_pubkey` (x-only) for P2TR sellers
- [ ] Use quote `assetUtxoId` / `assetUtxoValue` on create (do not trust caller-supplied values after quote)
- [ ] Extract signed prep tx hex from signed `prep_psbt` for `funding_tx_hex` (`finalizeAllInputs()` then `Psbt.extractTransaction().toHex()`)
- [ ] Reject `requestSellQuote` / `openSellOrder` with `listingType: "zeld"` when `network !== "mainnet"` (server returns 400 on testnet)
- [ ] Reject `openSellOrder` with `listingType: "zeld"` and **no** `assetUtxoId` in v1 (transfer prep → Phase 7); xcp attach prep without `assetUtxoId` remains v1
- [ ] For ordinal buys: require exactly one `swapId` + `buyerTaprootAddress` (or fetch via `getSwap` and infer `listingType === "ordinal"`)
- [ ] Expose `getPendingPurchaseTxIds` for post-`fillSwaps` polling
- [ ] Validate buyer address is P2WPKH before `buy-quotes` / `purchases`
- [ ] Map API errors to `HorizonMarketApiError` with status + server message (`404` delisted / unavailable, `400` conflicting UTXO params)
- [ ] Optional debug logging (quote response, inputs signed)

### Deliverables
- `HorizonMarketClient` with sell / buy / delist
- Examples in `examples/`

---

## Phase 5 — Integration tests and validation (2 days)

### Goals
Validate quote → sign → submit against a real Horizon API deployment.

### Tasks
- [ ] Opt-in integration tests (`INTEGRATION=1`):
  - Staging or local `next dev` + postgres
  - Bitcoin testnet keys with known UTXOs
- [ ] E2E xcp existing UTXO: sell → buy
- [ ] E2E xcp attach prep (omit `asset_utxo_id` on quote)
- [ ] E2E delist
- [ ] E2E ordinal sell + buy (with `buyer_taproot_address`)
- [ ] E2E zeld sell (existing UTXO) + buy on **mainnet only** — manual / opt-in (real sats + ZELD UTXO); **skip in CI** by default
- [ ] Assert signed PSBTs are accepted by server (no composition drift)

### Deliverables
- Documented integration test suite
- Manual validation checklist

---

## Phase 6 — Documentation and publishing (1 day)

### Tasks
- [ ] README:
  - Install + quick start (sell / buy / delist)
  - Quote → sign → submit diagram
  - Private key security warnings
  - Taproot / ordinal requirements
  - What callers must provide (`asset_utxo_id`, etc.)
  - `getLockedAssetUtxoIds` — avoid spending or re-listing locked UTXOs
- [ ] JSDoc on public API
- [ ] CHANGELOG
- [ ] Publish `@horizon-market/client` v0.1.0

### Deliverables
- Published package with docs that reference `apiary.apib`, not Horizon Market internals

---

## Phase 7 (later) — Extensions

| Extension | Description |
|---|---|
| **ZELD transfer-prep sell** | See [ZELD — v1 vs Phase 7](#zeld--v1-vs-phase-7) — finalize `prep_psbt` → `zeld_payment`; existing-UTXO ZELD sell is v1 |
| **Advanced PSBT composition** | Optional `psbt/` module ported from web (`newSalePsbt`, `newMultiBuyPsbt`) + `fee-quotes` only path |
| **Optional auth** | Email OTP + wallet challenge |
| **CLI** | `horizon-market sell`, `horizon-market buy` |
| **Type generation** | Script parsing `apiary.apib` → TS types |
| **Browser bundle** | Node-first; document private-key risks in browser |

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Reordering PSBT inputs before sign | Buy fails (detach OP_RETURN keyed on input 0) | Document + never expose reorder helpers; sign in server order |
| Swapping attach commit / reveal txids | Listing invalid / wrong UTXO spent | Use quote `asset_utxo_id`; `funding_tx_hex` = signed commit; `reveal_tx_hex` unchanged |
| Stale `fee_payment_id` (>30 min) | `400 Invalid OnChainPayment` | Sign+submit promptly; re-quote on failure |
| Missing `seller_pubkey` for P2TR sell | 400 from `sell-quotes` | Auto-attach x-only pubkey from signer |
| Missing `buyer_taproot_address` for ordinal | 400 from `buy-quotes` | Require in `fillSwaps` when listing_type is ordinal |
| Finalizing swap/fee PSBT before create | Server may reject or mis-broadcast | Only **prep** is finalized to raw tx; swap/fee stay as signed PSBT hex |
| Wrong sighash on signed inputs | Server rejects PSBT | Sign only listed indices; do not change `sighashType` |
| Taproot tweak incorrect | Invalid P2TR signature | Port `createTaprootSigner` from Web3Auth as-is |
| Delist BIP322 vs BIP137 | Delist rejected | Use `bip322-js` `Signer.sign` + base64 wire sig — Web3Auth BIP137 is incompatible |
| Wrong HTTP request envelope | 400 parse errors | Flat snake_case for public endpoints; never wrap everything in `{ data }` |
| ZELD transfer-prep sell | Needs finalize + `zeld_payment` | Phase 7 only; **ZELD existing-UTXO sell** is v1 |
| ZELD on testnet | 400 from server | Guard in workflow when `network !== "mainnet"` |
| Caller lacks `asset_utxo_id` for existing-UTXO path | Cannot open that sell mode | Document attach-prep alternative; `getLockedAssetUtxoIds` avoids conflicts only |
| `bigint` in `JSON.stringify` for create | Runtime throw or silent corruption | Serialize `asset_quantity` as number or string per watchouts; never pass raw `bigint` to `fetch` body |
| ZELD idempotency **200** mistaken for new listing | Caller thinks create succeeded twice | Return `{ swap, created: false }` from `openSellOrder`; document in JSDoc |
| Blind retry on xcp/ordinal create | Duplicate listings / wasted fees | Only ZELD has idempotent create; treat other creates as non-idempotent |

---

## Recommended priority order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
                              ↑
                    Critical path: signer + workflows
```

**Critical path:** Phase 2 (HTTP + quote types) → Phase 3 (signer) → Phase 4 (workflows).

**First demonstrable milestone:** xcp testnet listing (existing UTXO) via `sell-quotes` → sign swap+fee → `POST /api/atomic-swaps` (Phases 2–4 partial). Second: xcp attach prep (no upfront `asset_utxo_id`).

---

## Overall estimate

| Phase | Estimated duration |
|---|---|
| 0 — Analysis | 0.5–1 d |
| 1 — Scaffolding | 1 d |
| 2 — HTTP / types (incl. quotes) | 2 d |
| 3 — Crypto signer | 2–3 d |
| 4 — Workflows (incl. attach prep) | 2.5–3 d |
| 5 — Integration | 2–2.5 d |
| 6 — Docs / publish | 1 d |
| **Total v1** | **~11–13 days** |

Server-side composition removes the PSBT-composition port and indexer module; attach-prep and dual type layers add modest scope vs a “swap+fee only” sketch.

---

## ZELD — v1 vs Phase 7

ZELD has **two sell modes** in apiary; only one is deferred:

| ZELD sell mode | v1 | Flow |
|---|---|---|
| **Existing asset UTXO** | ✅ `openSellOrder` | Same as xcp: `sell-quotes` → sign `swap_psbt` + `fee_psbt` → create with `fee_payment` |
| **Transfer prep** (omit `asset_utxo_id`) | ❌ Phase 7 | `sell-quotes` → sign `prep_psbt` + `swap_psbt` → **finalize** prep → `zeld_payment` on create |
| **Buy** | ✅ `fillSwaps` | Same as xcp (`buy-quotes` → sign → `purchases`) |

**Mainnet only** — guard `network === "mainnet"` for any ZELD workflow.

### v1 (existing UTXO — PSBT-only)

```
sell-quotes  →  sign swap_psbt + fee_psbt  →  POST /api/atomic-swaps + fee_payment
```

Requires `asset_name: "ZELD"`, `asset_utxo_id`, and `asset_quantity` on quote and create.

### Phase 7 (transfer prep — finalize step)

```
sell-quotes  →  sign prep_psbt + swap_psbt  →  finalize prep_psbt  →  POST + zeld_payment
                     fee_psbt = null              (raw tx hex/tid)
```

After signing `prep_psbt`, the client must **finalize** it (`signedPrep.finalizeAllInputs()` then `const tx = signedPrep.extractTransaction()`), not submit the PSBT. Set `zeld_send_tx_hex = tx.toHex()` and `zeld_send_txid = tx.getId()` (bitcoinjs-lib display txid). The raw tx is both the isolated ZELD UTXO prep and the platform-fee carrier. `funding_tx_hex` is **not** used for zeld transfer prep (apiary).

`payment_address` / `payment_amount` on the quote describe the BTC fee output **inside** the prep tx — informational; no separate ZELD-send composer is needed if the server already composed `prep_psbt`.

### ZELD create idempotency (v1 + Phase 7)

For **any** `listing_type: "zeld"` create (existing UTXO in v1, transfer prep in Phase 7), retrying the same seller `asset_utxo_id` with an **identical** payload returns **200** with the existing swap; conflicting open listings return **409** (`Conflicting zeld listing`). Server “identical” means matching **`psbt_hex`**, **`price`**, and **`asset_quantity`** (see `zeld-listing-idempotency.ts`). Implement in `createSwap` / `openSellOrder` from v1 for existing-UTXO ZELD sells — not deferred to Phase 7.

### v1 ZELD coverage (summary)

- ✅ `fillSwaps` (buy)
- ✅ `openSellOrder` with `listingType: "zeld"` when `assetUtxoId` is provided (existing UTXO)
- ✅ `requestSellQuote` types for transfer prep (`paymentAddress`, `prepPsbt`, etc.)
- ❌ `openSellOrder` without `assetUtxoId` (transfer prep) until Phase 7

---

## Immediate next step

1. **Phase 0:** smoke-test `sell-quotes` and `buy-quotes` on staging/testnet.
2. **Phase 1:** init package in parallel.
3. **Phase 3:** extract Web3Auth `signPsbt` / `createTaprootSigner` for PSBT signing; implement delist message signing fresh with `bip322-js` Signer (do not reuse Web3Auth `signMessage`).
