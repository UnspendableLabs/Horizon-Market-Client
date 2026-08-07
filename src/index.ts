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
  KontorUnavailableReason,
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
// Safe recovery for a KontorPurchaseNotRecordedError: replay only the recording
// POST (client.recordKontorPurchase) with the carried txid — never re-accept.
export {
  kontorPurchaseRecovery,
  type KontorPurchaseRecovery,
} from "./kontor/purchase-recovery.js";
// Thrown by every Kontor operation when the client was not constructed with
// `kontorNetwork` — exported so consumers can `instanceof` it.
export { KontorUnavailableError } from "./kontor/runtime.js";
// Pre-flight failures — thrown before anything is signed, broadcast, or paid,
// so a caller catching these can surface a fix ("fund your Kontor account with
// KOR", "connect the owning wallet") and let the user retry safely.
export {
  KontorInsufficientGasError,
  KontorAssetUnavailableError,
  KontorEscrowNotFundedError,
  isKontorPreflightRefusal,
  korCostForGas,
  detachGasLimitFromBlob,
  maxListableKor,
  KONTOR_ATTACH_GAS_LIMIT,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_DETACH_GAS_LIMIT,
} from "./kontor/preflight.js";
export type {
  KontorGasOperation,
  KontorPreflightRefusal,
  KontorPreflightResult,
  KontorListingPreflightParams,
} from "./kontor/preflight.js";
export type { KontorListingFeePreview } from "./api/kontor.js";
// The signet KOR faucet — the way out of the "no gas, so no way to get gas"
// deadlock the pre-flights above report. `client.requestKontorFaucet()` is the
// ergonomic form (it knows the wallet's key and the configured endpoint); this
// is the bare wire call, for a caller holding a recipient key and nothing else.
export {
  requestKontorFaucet,
  KONTOR_FAUCET_AMOUNT_KOR,
} from "./kontor/faucet.js";
export type {
  KontorFaucetResult,
  RequestKontorFaucetParams,
} from "./kontor/faucet.js";
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
  SwapFacets,
  SwapFacetsParams,
  PriceBucketFacet,
  CollectionFacet,
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

// Profiles (`/api/profiles/*`) — the account's own profile (session-gated) and
// the public read surface. `isPlaceholderUsername` tells the random UUID a fresh
// account is created with apart from a username the user actually picked;
// `publicAvatarUrl` builds a public avatar URL without a round-trip (the
// client's own methods carry the configured origin).
export { isPlaceholderUsername, publicAvatarUrl } from "./api/profiles.js";
export type {
  MyProfile,
  PublicProfile,
  UpdateMyProfileParams,
  UsernameAvailability,
  ProfileWallet,
  WalletVisibility,
  ProfileAsset,
  ProfileAssetPage,
  ProfileSwapPage,
  ProfilePageParams,
  PointsSummary,
  RewardAction,
  RewardActionStatus,
  FollowState,
  AvatarUpload,
  AvatarUploadResult,
} from "./api/profiles.js";

// Manual sell workflow helper (quote → sign → submit)
export {
  signAndFinalizeSellPrep,
  type SignedSellPrepResult,
} from "./workflows/sell-prep.js";
