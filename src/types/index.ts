export type ListingType = "xcp" | "ordinal" | "zeld";
export type PrepKind = "attach" | "zeld_transfer" | null;
export type Network = "mainnet" | "testnet";

export interface Pagination {
  total: number;
  offset: number;
  limit: number | null;
}

export interface OnChainPayment {
  id: string;
  confirmed: boolean;
  txid: string | null;
  /** Present in live responses; not listed in apiary but safe to parse. */
  sats?: number;
  toAddress?: string;
}

export interface AtomicSwap {
  id: string;
  listingType: ListingType;
  sellerAddress: string;
  buyerAddress: string | null;
  assetUtxoId: string | null;
  assetUtxoValue: number | null;
  assetName: string | null;
  assetQuantity: bigint | null;
  price: number;
  pricePerUnit: number | null;
  psbtHex: string;
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
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  onChainPayment: OnChainPayment | null;
}

export interface ListSwapsResult {
  count: number;
  atomicSwaps: AtomicSwap[];
  assetMedia: Record<string, unknown>;
  pagination: Pagination;
}

export type LockedAssetUtxoIds = Record<string, true>;

export interface AssetNameSearchResult {
  assetNames: string[];
  assetMedia: Record<string, unknown>;
}

export interface PendingSale {
  txId: string;
  buyerAddress: string;
  atomicSwap: { id: string };
}

export interface DelistRequest {
  /** BIP322-sign this exact string, then PUT …/delist-requests/{id} */
  id: string;
  atomicSwap: { id: string; sellerAddress: string };
}

export interface SellQuote {
  swapPsbt: string;
  swapInputsToSign: number[];
  feePsbt: string | null;
  feeInputsToSign: number[];
  feePaymentId: string;
  /** Use on create — may be reveal txid:0 for attach+reveal. */
  assetUtxoId: string;
  /** Use on create. */
  assetUtxoValue: number;
  prepPsbt: string | null;
  prepInputsToSign: number[];
  prepKind: PrepKind;
  /** Attach: pass unchanged on create. */
  revealTxHex?: string;
  /** ZELD transfer prep only. */
  paymentAddress?: string;
  /** ZELD transfer prep only. */
  paymentAmount?: number;
}

export interface BuyQuote {
  psbt: string;
  inputsToSign: number[];
  feeEstimateSats: number;
  royaltySats: number;
  royaltyAddress: string | null;
}

export interface FeeQuoteBtc {
  feePaymentId: string;
  psbt: string;
  rawTransaction: string;
  inputsToSign: number[];
}

export interface FeeQuoteZeldTransferPrep {
  feePaymentId: string;
  paymentAddress: string;
  paymentAmount: number;
}

export interface FeePayment {
  psbtHex: string;
  feePaymentId: string;
}

export interface ZeldPayment {
  zeldSendTxid: string;
  zeldSendTxHex: string;
  feePaymentId: string;
}

export interface AtomicSwapCreateRequest {
  assetUtxoId: string;
  assetUtxoValue: number;
  assetName?: string | null;
  assetQuantity?: bigint | number | null;
  price: number;
  sellerAddress: string;
  psbtHex: string;
  listingType?: ListingType;
  /** RFC 3339 UTC; omit = no expiry. */
  expiresAt?: string | null;
  feePayment?: FeePayment;
  /** Phase 7 */
  zeldPayment?: ZeldPayment;
  /** Signed attach commit tx hex (xcp prep). */
  fundingTxHex?: string;
  /** From quote when attach+reveal. */
  revealTxHex?: string;
}

export interface CreateSwapResult {
  swap: AtomicSwap;
  status: 200 | 201;
  created: boolean;
}

export interface ConfirmDelistResult {
  id: string;
  signature: string;
}

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

export interface SellQuoteParams {
  price: number;
  sellerAddress: string;
  sellerPubkey?: string;
  listingType?: ListingType;
  assetUtxoId?: string;
  assetName?: string;
  assetQuantity?: bigint | number;
  satsPerVbyte?: number;
  feeUtxoIds?: string[];
  autoSelectFeeUtxos?: boolean;
}

export interface BuyQuoteParams {
  swapIds: string[];
  buyerAddress: string;
  buyerTaprootAddress?: string;
  satsPerVbyte?: number;
  fundingUtxoIds?: string[];
  autoSelect?: boolean;
  detach?: boolean;
}
