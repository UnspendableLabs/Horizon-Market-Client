/**
 * Domain types for the Horizon Market Atomic Swap API.
 *
 * Public SDK methods use these camelCase shapes. Wire JSON uses snake_case;
 * the `api/` module maps between them.
 *
 * **Pricing:** `price` on listings is the net sats the seller receives. Buyers
 * pay `price + royalty` (royalty grossed up on buy quotes).
 *
 * **State flags on {@link AtomicSwap}:**
 * - `funded` — seller asset UTXO confirmed on-chain
 * - `confirmed` — platform fee tx confirmed
 * - `pending` — buy tx in mempool
 * - `anomalous` — swap is not purchasable
 *
 * New attach-prep or zeld transfer-prep listings may stay `funded: false` until
 * the prep tx confirms — poll {@link AtomicSwap} via `getSwap` before `fillSwaps`.
 */
export type ListingType = "counterparty" | "ordinal" | "zeld" | "kontor";

/** Kind of Kontor asset escrowed in a `listingType: "kontor"` swap. */
export type KontorAssetKind = "token" | "nft";

/** Prep transaction kind returned by sell-quotes when `prepPsbt` is present. */
export type PrepKind = "attach" | "zeld_transfer" | null;

/**
 * Spendable taproot UTXO used to fund a Kontor on-chain transaction (the seller's
 * attach reveal or the buyer's commit). `bigint`-free so consumers never import
 * `@kontor/sdk` types. Omit `scriptPubKey` to have the client derive it from the
 * funding taproot address.
 */
export interface KontorUtxoInput {
  txid: string;
  vout: number;
  /** Value in sats. */
  value: number;
  /** P2TR scriptPubKey hex. Derived from the taproot address when omitted. */
  scriptPubKey?: string;
}

/** A static list of funding UTXOs, or a fetcher re-queried on each on-chain submit. */
export type KontorFunding =
  | KontorUtxoInput[]
  | (() => Promise<KontorUtxoInput[]>);

/** Bitcoin network for address derivation and PSBT signing. */
export type Network = "mainnet" | "testnet";

/** Optional per-request options for REST helpers (e.g. cancellation). */
export interface RequestOptions {
  signal?: AbortSignal;
}

/** Pagination metadata from list endpoints. `limit` is null when omitted in the request. */
export interface Pagination {
  total: number;
  offset: number;
  limit: number | null;
}

/** Platform fee payment associated with a listing. */
export interface OnChainPayment {
  id: string;
  confirmed: boolean;
  txid: string | null;
  /** Present on the single-swap detail's full `OnChainPayment`; absent from the reduced `OnChainPaymentSummary` in the create response. */
  sats?: number;
  toAddress?: string;
}

/** Atomic swap listing returned by the API. */
export interface AtomicSwap {
  id: string;
  listingType: ListingType;
  sellerAddress: string;
  buyerAddress: string | null;
  assetUtxoId: string | null;
  assetUtxoValue: number | null;
  assetName: string | null;
  /** Parsed from wire number or string (large values). */
  assetQuantity: bigint | null;
  /** Net sats the seller receives. */
  price: number;
  pricePerUnit: number | null;
  /** Null until the swap is funded on-chain. */
  psbtHex: string | null;
  txId: string | null;
  blockIndex: number | null;
  /** Asset UTXO confirmed on-chain. */
  funded: boolean;
  /** Swap transaction filled/sold. */
  filled: boolean;
  /** Platform fee tx confirmed. */
  confirmed: boolean;
  /** Listing has been delisted. */
  delisted: boolean;
  /** Delisted by the seller (vs. admin). */
  sellerDelisted: boolean;
  /** Listing has expired. */
  expired: boolean;
  /** Buy tx is in mempool. */
  pending: boolean;
  /** Swap is not purchasable (anomalous state). */
  anomalous: boolean;
  royalty: number | null;
  /** ISO 8601 UTC. */
  expiresAt: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
  onChainPayment: OnChainPayment | null;
  user?: { id: string } | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  inscriptionNumber: number | null;
  assetDivisibility: boolean | null;
  /** Kontor offer blob (signed attach reveal + seller-signed detach PSBT). Only set when `listingType === "kontor"`. */
  kontorOfferBlob: string | null;
  /** `"token"` (KOR) or `"nft"`. Only set when `listingType === "kontor"`. */
  kontorAssetKind: KontorAssetKind | null;
  /** Kontor contract address (`name@height.txIndex`). Only set when `listingType === "kontor"`. */
  kontorContractAddress: string | null;
  /** Kontor NFT id. Only set for `listingType === "kontor"` NFT listings. */
  kontorNftId: string | null;
  /** KOR token amount as a positive decimal string. Only set for `listingType === "kontor"` token listings. */
  kontorAmount: string | null;
}

/** Result of `listSwaps`. `count` mirrors `pagination.total`. */
export interface ListSwapsResult {
  count: number;
  atomicSwaps: AtomicSwap[];
  pagination: Pagination;
}

/** Locked asset UTXO ids for seller address(es). Keys are `{txid}:{vout}` strings. */
export type LockedAssetUtxoIds = Record<string, true>;

/** Distinct listed asset names from search. */
export interface AssetNameSearchResult {
  assetNames: string[];
  assetMedia: Record<string, unknown>;
}

/** In-flight purchase after `fillSwaps` / `purchaseSwaps`. */
export interface PendingSale {
  txId: string;
  buyerAddress: string;
  atomicSwap: { id: string };
}

/** Delist request — BIP322-sign `id`, then confirm via PUT. */
export interface DelistRequest {
  /** BIP322-sign this exact string, then PUT …/delist-requests/{id} */
  id: string;
  atomicSwap: { id: string; sellerAddress: string };
}

/** Response from `POST /api/atomic-swaps/sell-quotes`. */
export interface SellQuote {
  swapPsbt: string;
  swapInputsToSign: number[];
  feePsbt: string | null;
  feeInputsToSign: number[];
  /** Expires in ~30 minutes — sign and submit promptly. Null when `feeWaived`. */
  feePaymentId: string | null;
  /** Platform fee waived (subscription/credits). Omit fee/zeld payment on create. */
  feeWaived: boolean;
  /** Use on create — may be reveal txid:0 for attach+reveal. */
  assetUtxoId: string;
  /** Use on create. */
  assetUtxoValue: number;
  prepPsbt: string | null;
  prepInputsToSign: number[];
  prepKind: PrepKind;
  /** Attach: pass unchanged on create. */
  revealTxHex?: string;
  /** ZELD transfer prep only (informational — fee is inside prep tx). */
  paymentAddress?: string;
  /** ZELD transfer prep only. */
  paymentAmount?: number;
  /** Platform fee in sats. Null when waived. */
  listingFeeSats: number | null;
  /** Miner fee of the prep tx in sats. Null when an existing UTXO is reused. */
  attachFeeSats: number | null;
  /** Miner fee of the standalone platform-fee tx in sats. Null when folded into the prep tx or waived. */
  networkFeeSats: number | null;
}

/** Response from `POST /api/atomic-swaps/buy-quotes`. */
export interface BuyQuote {
  psbt: string;
  /** Sign only these indices; preserve input order (detach OP_RETURN on input 0). */
  inputsToSign: number[];
  feeEstimateSats: number;
  royaltySats: number;
  royaltyAddress: string | null;
}

/** BTC fee quote from `POST /api/atomic-swaps/fee-quotes` (advanced). */
export interface FeeQuoteBtc {
  feePaymentId: string;
  psbt: string;
  rawTransaction: string;
  inputsToSign: number[];
}

/** ZELD transfer-prep fee output from fee-quotes (advanced). */
export interface FeeQuoteZeldTransferPrep {
  feePaymentId: string;
  paymentAddress: string;
  paymentAmount: number;
}

/** Signed platform fee PSBT submitted on create (counterparty, ordinal, zeld existing UTXO). */
export interface FeePayment {
  /**
   * Signed fee PSBT hex. Omitted for counterparty attach folded-fee listings —
   * there the platform-fee output rides inside the attach prep tx (sent as
   * `fundingTxHex`), so only the `feePaymentId` is submitted.
   */
  psbtHex?: string;
  feePaymentId: string;
}

/** Finalized ZELD transfer prep tx submitted on create (zeld transfer prep sell). */
export interface ZeldPayment {
  zeldSendTxId: string;
  zeldSendTxHex: string;
  feePaymentId: string;
}

/** Body for `createSwap` / `POST /api/atomic-swaps`. */
export interface AtomicSwapCreateRequest {
  /** From sell quote — do not trust caller-supplied values after quoting. */
  assetUtxoId: string;
  assetUtxoValue: number;
  assetName?: string | null;
  assetQuantity?: bigint | number | null;
  /** Net sats the seller receives. */
  price: number;
  sellerAddress: string;
  /** Signed swap PSBT hex (not finalized). */
  psbtHex: string;
  listingType?: ListingType;
  /** RFC 3339 UTC; omit = no expiry. */
  expiresAt?: string | null;
  feePayment?: FeePayment;
  /** ZELD transfer prep — signed prep tx (not used for existing-UTXO or counterparty attach sells). */
  zeldPayment?: ZeldPayment;
  /** Signed attach commit tx hex (counterparty attach prep). */
  fundingTxHex?: string;
  /** From quote when attach+reveal. */
  revealTxHex?: string;
}

/** Result of `createSwap`. `created: false` on ZELD idempotent HTTP 200 replay. */
export interface CreateSwapResult {
  swap: AtomicSwap;
  status: 200 | 201;
  /** `true` on HTTP 201 (new listing); `false` on ZELD idempotent HTTP 200. */
  created: boolean;
}

/** Result of `confirmDelist`. */
export interface ConfirmDelistResult {
  id: string;
  /** Null when the server has not yet stored a signature on the request. */
  signature: string | null;
}

/** Query params for `listSwaps`. Unset booleans use server defaults. */
export interface ListSwapsParams {
  assetName?: string;
  search?: string;
  sellerAddress?: string;
  buyerAddress?: string;
  listingType?: ListingType;
  funded?: boolean;
  filled?: boolean;
  delisted?: boolean;
  unattached?: boolean;
  sales?: boolean;
  order?: "asc" | "desc";
  orderBy?: "created_at" | "updated_at" | "price" | "price_per_unit";
  offset?: number;
  limit?: number;
}

/** Params for `requestSellQuote` / sell-quotes. Omit `assetUtxoId` for attach or zeld transfer prep. */
export interface SellQuoteParams {
  /** Net sats the seller receives. */
  price: number;
  sellerAddress: string;
  /** Required for P2TR sellers (32-byte x-only hex). */
  sellerPubkey?: string;
  listingType?: ListingType;
  assetUtxoId?: string;
  assetName?: string;
  assetQuantity?: bigint | number;
  satsPerVbyte?: number;
  /** Mutually exclusive with `autoSelectFeeUtxos`. */
  feeUtxoIds?: string[];
  autoSelectFeeUtxos?: boolean;
  /**
   * Compute the cost breakdown (`listingFeeSats` / `attachFeeSats` /
   * `networkFeeSats`) **without** persisting an `OnChainPayment`. PSBTs returned
   * by a preview quote must not be signed or submitted.
   */
  preview?: boolean;
}

/** Params for `requestBuyQuote` / buy-quotes. Buyer address must be P2WPKH. */
export interface BuyQuoteParams {
  swapIds: string[];
  buyerAddress: string;
  /** Required for ordinal buys (receives the inscription). */
  buyerTaprootAddress?: string;
  satsPerVbyte?: number;
  /** Mutually exclusive with `autoSelect`. */
  fundingUtxoIds?: string[];
  autoSelect?: boolean;
  /** Counterparty only; default `true` on server. Ignored for zeld. */
  detach?: boolean;
}

export type {
  DelistSwapStep,
  FillSwapsStep,
  OpenSellOrderStep,
  WorkflowName,
  WorkflowOptions,
  WorkflowProgressEvent,
  WorkflowProgressPhase,
  WorkflowStep,
} from "./progress.js";
