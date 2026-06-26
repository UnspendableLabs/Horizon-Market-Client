// Main client
export { HorizonMarketClient } from "./client.js";
export type {
  OpenSellOrderParams,
  FillSwapsParams,
  DelistSwapOptions,
  CounterpartyBalance,
  ZeldBalance,
  KontorBalance,
  KontorNftHolding,
  KontorHoldings,
} from "./client.js";

// Kontor (KOR token + NFT) sell params and orphan-recovery error
export type {
  KontorSellParams,
  KontorTokenSellParams,
  KontorNftSellParams,
} from "./workflows/sell-kontor.js";
export { KontorListingNotRecordedError } from "./workflows/sell-kontor.js";
export { KontorDelistNotRecordedError } from "./workflows/delist-kontor.js";
export type { PsbtSellOrderParams } from "./workflows/sell.js";

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
  KontorAssetKind,
  KontorFunding,
  KontorUtxoInput,
  ListingType,
  ListSwapsParams,
  ListSwapsResult,
  LockedAssetUtxoIds,
  Network,
  OnChainPayment,
  Pagination,
  PendingSale,
  PrepKind,
  RequestOptions,
  SellQuote,
  SellQuoteParams,
  ZeldPayment,
  DelistSwapStep,
  FillSwapsStep,
  OpenSellOrderStep,
  WorkflowName,
  WorkflowOptions,
  WorkflowProgressEvent,
  WorkflowProgressPhase,
  WorkflowStep,
} from "./types/index.js";

// Config
export type { HorizonMarketClientOptions } from "./config.js";
export {
  DEFAULT_BASE_URL,
  DEFAULT_KONTOR_INDEXER_URL,
  DEFAULT_COUNTERPARTY_API_BASE_URL,
  DEFAULT_ZELD_API_BASE_URL,
} from "./config.js";

// Advanced (fee-quotes)
export type { FeeQuoteParams } from "./api/fee-quotes.js";

// Authentication (wallet sign-in for platform-fee credits)
export type {
  WalletChallenge,
  WalletSignInParams,
  SessionInfo,
} from "./api/auth.js";

// Manual sell workflow helper (quote → sign → submit)
export {
  signAndFinalizeSellPrep,
  type SignedSellPrepResult,
} from "./workflows/sell-prep.js";
