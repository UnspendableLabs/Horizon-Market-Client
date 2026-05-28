// Main client
export { HorizonMarketClient } from "./client.js";
export type { OpenSellOrderParams, FillSwapsParams } from "./client.js";

// Error class
export { HorizonMarketApiError } from "./api/http.js";

// Signer
export type { Signer } from "./crypto/signer.js";
export { LocalSigner } from "./crypto/signer.js";

// Domain types
export type {
  AtomicSwap,
  AssetNameSearchResult,
  AtomicSwapCreateRequest,
  BuyQuote,
  BuyQuoteParams,
  ConfirmDelistResult,
  CreateSwapResult,
  DelistRequest,
  FeePayment,
  FeeQuoteBtc,
  FeeQuoteZeldTransferPrep,
  ListingType,
  ListSwapsParams,
  ListSwapsResult,
  LockedAssetUtxoIds,
  Network,
  OnChainPayment,
  Pagination,
  PendingSale,
  PrepKind,
  SellQuote,
  SellQuoteParams,
  ZeldPayment,
} from "./types/index.js";

// Config
export type { HorizonMarketClientOptions } from "./config.js";

// Advanced (fee-quotes)
export type { FeeQuoteParams } from "./api/fee-quotes.js";
