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
} from "./components/WalletBalances.web.js";

export { WalletBalanceSummary } from "./components/WalletBalanceSummary.web.js";
export type {
  WalletBalanceSummaryProps,
  WalletBalanceSummaryClassNames,
} from "./components/WalletBalanceSummary.web.js";
