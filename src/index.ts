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

// Unified send / withdraw (all asset types)
export { sendAsset, prepareSend } from "./send/index.js";
export type {
  SendRequest,
  SendResult,
  SendKind,
  SendDeps,
  SendNetwork,
  PreparedSend,
} from "./send/index.js";

// Kontor (KOR token + NFT) sell params and orphan-recovery error
export type {
  KontorSellParams,
  KontorTokenSellParams,
  KontorNftSellParams,
} from "./workflows/sell-kontor.js";
export { KontorListingNotRecordedError } from "./workflows/sell-kontor.js";
export { KontorDelistNotRecordedError } from "./workflows/delist-kontor.js";
export { KontorPurchaseNotRecordedError } from "./workflows/buy-kontor.js";
// Thrown by every Kontor operation when the client was not constructed with
// `kontorNetwork` — exported so consumers can `instanceof` it.
export { KontorUnavailableError } from "./kontor/runtime.js";
export type { KontorListingFeePreview } from "./api/kontor.js";
export type {
  PsbtSellOrderParams,
  SellBroadcastTx,
  SellBroadcastTxKind,
} from "./workflows/sell.js";

// Error class
export { HorizonMarketApiError } from "./api/http.js";

// Signer
export type { Signer } from "./crypto/signer.js";
// LocalSigner: single-key (web3auth). HDSigner: Horizon-Wallet-compatible HD (BIP84 + BIP86).
export { LocalSigner, HDSigner } from "./crypto/signer.js";

// Mnemonic / BIP39 (generate, validate, derive keys, web3auth-key bridge)
export {
  generateMnemonic,
  validateMnemonic,
  mnemonicToPrivateKey,
  privateKeyToMnemonic,
  mnemonicToPrivateKeyEntropy,
  deriveHorizonWalletKeys,
  horizonWalletPath,
  coinTypeForNetwork,
  DEFAULT_DERIVATION_PATH,
  SEGWIT_PURPOSE,
  TAPROOT_PURPOSE,
} from "./crypto/mnemonic.js";
export type {
  MnemonicDeriveOptions,
  HorizonWalletDeriveOptions,
  HorizonWalletKeys,
  DerivedKey,
  PrivateKeyToMnemonicOptions,
} from "./crypto/mnemonic.js";

// Cross-platform encrypted keystore helpers (string → string, no file I/O)
export { encryptKeystore, decryptKeystore } from "./crypto/keystore.js";
export type { Keystore } from "./crypto/keystore.js";

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
  CreditBalance,
  WalletTokenSignIn,
} from "./api/auth.js";

// Manual sell workflow helper (quote → sign → submit)
export {
  signAndFinalizeSellPrep,
  type SignedSellPrepResult,
} from "./workflows/sell-prep.js";
