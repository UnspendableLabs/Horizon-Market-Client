export {
  HorizonMarketProvider,
  useHorizonMarket,
} from "./context.js";
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
  useWithdraw,
  WITHDRAW_FEE_OPTIONS,
  useSwapConfirmation,
  useSwapList,
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
  SwapConfirmationStep,
  SwapConfirmationStatus,
  UseSwapConfirmationOptions,
  UseSwapConfirmationResult,
  UsePricesResult,
  FeeEstimates,
  UseFeeEstimatesResult,
  SwapListOrderBy,
  SwapListOrder,
  SwapListingType,
  SortOption,
  UseSwapListOptions,
  UseSwapListResult,
} from "./hooks/index.js";

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
export { defaultTheme, resolveTheme } from "./theme.js";

export { Modal } from "./components/Modal.native.js";
export type { ModalProps } from "./components/Modal.native.js";

export { LoginPanel } from "./components/LoginPanel.native.js";
export type {
  LoginPanelProps,
  LoginPanelStyles,
} from "./components/LoginPanel.native.js";

export { SellOrderForm } from "./components/SellOrderForm.native.js";
export type {
  SellOrderFormProps,
  SellOrderFormStyles,
} from "./components/SellOrderForm.native.js";

export { WithdrawForm } from "./components/WithdrawForm.native.js";
export type {
  WithdrawFormProps,
  WithdrawFormStyles,
} from "./components/WithdrawForm.native.js";

export { SwapConfirmation } from "./components/SwapConfirmation.native.js";
export type {
  SwapConfirmationProps,
  SwapConfirmationStyles,
} from "./components/SwapConfirmation.native.js";

export { WorkflowProgress } from "./components/WorkflowProgress.native.js";
export type {
  WorkflowProgressProps,
  WorkflowProgressStyles,
} from "./components/WorkflowProgress.native.js";

export { SwapList } from "./components/SwapList.native.js";
export type {
  SwapListProps,
  SwapListStyles,
} from "./components/SwapList.native.js";

export { WalletBalances } from "./components/WalletBalances.native.js";
export type {
  WalletBalancesProps,
  WalletBalancesStyles,
  WalletDepositEvent,
  WalletWithdrawEvent,
  WalletWithdrawCompleteEvent,
} from "./components/WalletBalances.native.js";

export { WalletBalanceSummary } from "./components/WalletBalanceSummary.native.js";
export type {
  WalletBalanceSummaryProps,
  WalletBalanceSummaryStyles,
} from "./components/WalletBalanceSummary.native.js";
