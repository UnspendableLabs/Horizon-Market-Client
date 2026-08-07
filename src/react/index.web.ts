export { HorizonMarketProvider } from "./provider.web.js";
export { useHorizonMarket } from "./context.js";
export type {
  HorizonMarketContextValue,
  HorizonMarketProviderProps,
  DerivationMode,
  MnemonicWordCount,
  SessionSource,
  Addresses,
} from "./context.js";

// BIP39 helpers surfaced through the React entry so apps can offer a
// "Restore wallet" / "New HD wallet" connect flow without a second import path.
export { generateMnemonic, validateMnemonic } from "../crypto/mnemonic.js";

export {
  useTheme,
  useLoginPanel,
  useAssets,
  useBtcBalance,
  useSellOrder,
  useSellOrderForm,
  useWithdraw,
  WITHDRAW_FEE_OPTIONS,
  useSwapConfirmation,
  useSwapList,
  useProfile,
  useProfileWallets,
  useKontorFaucet,
  usePrices,
  useFeeEstimates,
  SORT_OPTIONS,
  SORT_OPTION_LABELS,
} from "./hooks/index.js";
export type {
  LoginPanelPhase,
  UseLoginPanelOptions,
  UseLoginPanelResult,
  AssetOption,
  SourceKey,
  SourceState,
  UseAssetsResult,
  UseBtcBalanceResult,
  WithdrawTarget,
  WithdrawStep,
  WithdrawStatus,
  WithdrawFeeOption,
  WithdrawFormValues,
  WithdrawResult,
  UseWithdrawOptions,
  UseWithdrawResult,
  SellOrderStep,
  SellOrderStatus,
  SellOrderFormValues,
  SellOrderResult,
  UseSellOrderOptions,
  UseSellOrderResult,
  AssetGroup,
  SellTrackTx,
  SellResultView,
  UseSellOrderFormResult,
  SwapConfirmationStep,
  SwapConfirmationStatus,
  UseSwapConfirmationOptions,
  UseSwapConfirmationResult,
  KontorFaucetStatus,
  UseKontorFaucetResult,
  UsePricesResult,
  FeeEstimates,
  UseFeeEstimatesResult,
  SwapListOrderBy,
  SwapListOrder,
  SwapListingType,
  SortOption,
  UseSwapListOptions,
  UseSwapListResult,
  UseProfileResult,
  UseProfileWalletsResult,
} from "./hooks/index.js";

// The profile payloads those two hooks hand back — re-exported here so an app
// can type its own profile screen without also importing the root entry (which
// would pull the whole client surface into a React-only bundle).
export type {
  MyProfile,
  UpdateMyProfileParams,
  ProfileWallet,
  AvatarUpload,
} from "../api/profiles.js";
export { isPlaceholderUsername } from "../api/profiles.js";

// The sell-review data layer that powers the packaged <SellOrderForm/> confirm
// step (cost breakdown, live fee-rate selection, fee waiver, and the Kontor
// fee estimates). Exported so an app can render its OWN confirmation UI on the
// exact same data — the same dogfooding stance apps take with useSellOrder.
export {
  useSellReview,
  FEE_HINTS,
  FEE_LABELS,
  FEE_OPTIONS,
} from "./internal/useSellReview.js";
export type {
  UseSellReviewArgs,
  UseSellReviewResult,
  FeeOption,
} from "./internal/useSellReview.js";
export type { SellCost } from "./internal/useSellQuotePreview.js";

// The buy-review data layer, symmetric with useSellReview above. Powers the
// packaged buy confirm step (price + royalty + miner fee breakdown, live
// fee-rate selection, and the Kontor fee estimates). Exported so an app can
// render its OWN buy confirmation UI on the exact same data. Only the hook and
// its arg/result types are re-exported here — FEE_HINTS/FEE_OPTIONS/FEE_LABELS/
// FeeOption are already exported via the useSellReview block above.
export { useBuyReview } from "./internal/useBuyReview.js";

// Which network-bound protocols this app shows at all (ZELD / Kontor), derived
// from the provider config — the rule behind the packaged wallet rows, sell
// groups and swap filter tabs. Exported so a host app can gate its OWN protocol
// UI (a custom filter sidebar, a nav entry) off the same switch, and
// `useSwapFilterTabs` is `FILTER_TABS` with that rule already applied.
export {
  useProtocolVisibility,
  useSwapFilterTabs,
} from "./internal/useProtocolVisibility.js";
export type { ProtocolVisibility } from "./internal/useProtocolVisibility.js";

// The Kontor chain-state gate behind all three review screens: can this wallet
// pay the op's gas, does it hold what it is listing, does the listing's escrow
// hold what it advertises. Already wired into `useBuyReview` / `useSellReview` /
// `useSwapConfirmation` (each exposes it as `preflight`), and exported here so an
// app rendering its OWN review UI can gate the same way instead of discovering
// the refusal after the user commits. `kontorPreflightNotice` is the shared
// wording the packaged renderers show, so a custom screen can match them.
export {
  useKontorPreflight,
  kontorPreflightNotice,
} from "./internal/useKontorPreflight.js";
// Kontor gas pricing — pure string/number arithmetic over values the client
// already holds, with no `@kontor/sdk` import anywhere behind it, so a React
// bundle that must never load the Kontor WASM backend can still show what an op
// costs. `useSellOrderForm` already applies `maxListableKor` to its Max
// affordance; these are for a host rendering its own ("gas ≈ 0.0001 KOR").
export {
  korCostForGas,
  maxListableKor,
  detachGasLimitFromBlob,
  KONTOR_ATTACH_GAS_LIMIT,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_DETACH_GAS_LIMIT,
} from "../kontor/gas.js";
// The signet KOR faucet `useKontorFaucet()` calls: the amount one request
// grants, and the two txids it returns. Plain HTTP — no `@kontor/sdk` behind it,
// so funding an account works in a bundle built without the Kontor backend.
export { KONTOR_FAUCET_AMOUNT_KOR } from "../kontor/faucet.js";
export type { KontorFaucetResult } from "../kontor/faucet.js";
export type {
  KontorPreflightTarget,
  KontorPreflightNotice,
  UseKontorPreflightResult,
} from "./internal/useKontorPreflight.js";
export type {
  UseBuyReviewArgs,
  UseBuyReviewResult,
} from "./internal/useBuyReview.js";

export type {
  HorizonMarketTheme,
  HorizonMarketThemeColors,
  HorizonMarketThemeTypography,
  HorizonMarketThemeSpacing,
  HorizonMarketThemeRadii,
  ResolvedTheme,
} from "./theme.js";
export { defaultTheme, resolveTheme, themeToCssVars, webTokens } from "./theme.js";

export { Modal } from "./components/Modal.web.js";
export type { ModalProps } from "./components/Modal.web.js";

export { LoginPanel } from "./components/LoginPanel.web.js";
export type {
  LoginPanelProps,
  LoginPanelClassNames,
} from "./components/LoginPanel.web.js";

export { SellOrderForm } from "./components/SellOrderForm.web.js";
export type {
  SellOrderFormProps,
  SellOrderFormClassNames,
} from "./components/SellOrderForm.web.js";

export { WithdrawForm } from "./components/WithdrawForm.web.js";
export type {
  WithdrawFormProps,
  WithdrawFormClassNames,
} from "./components/WithdrawForm.web.js";

export { SwapConfirmation } from "./components/SwapConfirmation.web.js";
export type {
  SwapConfirmationProps,
  SwapConfirmationClassNames,
} from "./components/SwapConfirmation.web.js";

export { WorkflowProgress } from "./components/WorkflowProgress.web.js";
export type {
  WorkflowProgressProps,
  WorkflowProgressClassNames,
} from "./components/WorkflowProgress.web.js";

export { SwapList } from "./components/SwapList.web.js";
export type {
  SwapListProps,
  SwapListClassNames,
} from "./components/SwapList.web.js";

export { WalletBalances } from "./components/WalletBalances.web.js";
export type {
  WalletBalancesProps,
  WalletBalancesClassNames,
  WalletDepositEvent,
  WalletWithdrawEvent,
  WalletWithdrawCompleteEvent,
} from "./components/WalletBalances.web.js";
// The headline-token shape `renderTokenAction` is called with (XCP/KOR/ZELD).
export type { TokenLine as WalletTokenLine } from "./internal/walletBalances.web.js";

export { WalletBalanceSummary } from "./components/WalletBalanceSummary.web.js";
export type {
  WalletBalanceSummaryProps,
  WalletBalanceSummaryClassNames,
} from "./components/WalletBalanceSummary.web.js";
