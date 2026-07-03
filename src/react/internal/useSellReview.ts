import { useMemo, useState } from "react";
import { useHorizonMarket } from "../context.js";
import { usePrices } from "../hooks/usePrices.js";
import { useFeeEstimates, type FeeEstimates } from "../hooks/useFeeEstimates.js";
import { useSellQuotePreview, type SellCost } from "./useSellQuotePreview.js";
import { useKontorListingFee } from "./useKontorListingFee.js";
import { useKontorMinerFee } from "./useKontorMinerFee.js";
import { estimateKontorMinerFee } from "./kontorFeeEstimate.js";
import { buildSellOrderParams } from "./sellFormValidation.js";
import { type FeeOption, rateForOption } from "./feeRate.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";
import type { OpenSellOrderParams } from "../../workflows/sell.js";

export { FEE_OPTIONS, FEE_LABELS, type FeeOption } from "./feeRate.js";

/**
 * Explanations shown via the (i) hints in the sell review, keeping the panel
 * compact. Shared by the web and native renderers. The Kontor attach miner-fee
 * hint is built inline (it interpolates the live fee rate) so it isn't here.
 */
export const FEE_HINTS = {
  attach:
    "Miner fee to place your asset on its own UTXO (Counterparty attach / ZELD transfer) so the swap can be created.",
  network:
    "Miner fee for the separate transaction that pays the platform listing fee.",
  listing: "Platform fee for listing your asset on the marketplace.",
};

export interface UseSellReviewArgs {
  formValues: SellOrderFormValues;
  defaultSatsPerVbyte?: number;
  /** Only fetch quotes/prices while the confirm step is shown. */
  active: boolean;
}

export interface UseSellReviewResult {
  /** Live recommended fee rates (null until loaded). */
  estimates: FeeEstimates | null;
  /** Selected speed preset. */
  feeOption: FeeOption;
  setFeeOption: (option: FeeOption) => void;
  /** Effective sat/vByte for the selected preset (undefined until estimates load). */
  feeRate: number | undefined;
  /** sat/vByte for a given preset, for labelling the selector. */
  rateFor: (option: FeeOption) => number | undefined;
  /** BTC→USD price (null until loaded). */
  btcUsd: number | null;
  /** True for KOR/NFT listings (Kontor cost model differs from PSBT listings). */
  isKontor: boolean;
  cost: SellCost | null;
  feeWaived: boolean;
  /**
   * True when the listing fee is covered by consuming one account credit (the
   * server waived the fee AND the account holds ≥1 credit). Drives the "1 credit"
   * label in the review. False for subscription-only waivers (shown as "Free").
   * Applies to both PSBT and Kontor listings — the server honours credits for
   * Kontor too, dropping the on-chain fee output.
   */
  paidWithCredit: boolean;
  previewLoading: boolean;
  previewError: Error | null;
  /**
   * False when the active fee preview failed — the cost couldn't be estimated
   * (e.g. insufficient BTC), so signing would compose an order guaranteed to
   * fail. Drives the review's disabled "Sign" button.
   */
  canSign: boolean;
  /** Kontor listing fee in sats (null until loaded). Only set for KOR/NFT. */
  kontorListingSats: number | null;
  kontorListingLoading: boolean;
  /** Kontor listing-fee preview error (null on success). Only set for KOR/NFT. */
  kontorListingError: Error | null;
  /** Estimated Kontor attach miner fee in sats (≈, scales with feeRate). */
  kontorMinerFeeSats: number | null;
  /** Estimated Kontor total (listing + miner fee) in sats (≈). */
  kontorTotalSats: number | null;
}

/**
 * Shared data layer for the platform-specific sell review screens. Owns the
 * fee-rate selection and combines it with the live price, recommended fees, and
 * a debounced side-effect-free cost preview.
 */
export function useSellReview({
  formValues,
  defaultSatsPerVbyte,
  active,
}: UseSellReviewArgs): UseSellReviewResult {
  const { estimates } = useFeeEstimates();
  const { btcUsd } = usePrices();
  const { credits, freeCredits } = useHorizonMarket();
  const [feeOption, setFeeOption] = useState<FeeOption>("normal");

  // The account holds at least one credit (free credits are spent first).
  const hasCredit = (credits ?? 0) + (freeCredits ?? 0) > 0;

  // Fall back to the caller's default (then the server default) until the live
  // estimates resolve.
  const feeRate = rateForOption(feeOption, estimates) ?? defaultSatsPerVbyte;

  const asset = formValues.asset;
  const isKontor = asset?.type === "kor" || asset?.type === "kontor-nft";

  const params = useMemo<OpenSellOrderParams | null>(() => {
    if (!active || !asset) return null;
    try {
      return buildSellOrderParams(formValues, feeRate);
    } catch {
      return null;
    }
  }, [active, asset, formValues, feeRate]);

  const preview = useSellQuotePreview(params, feeRate, active && !isKontor);

  // Kontor has no sell-quote; read its listing fee via the dedicated preview.
  const kontorAddress =
    asset && (asset.type === "kor" || asset.type === "kontor-nft")
      ? asset.address
      : null;
  const kontorFee = useKontorListingFee(kontorAddress, active && isKontor);

  // Calibrated attach miner-fee estimate (reveal vsize from a live same-kind
  // listing × the selected fee rate). The vsize fetch is rate-independent; the
  // sats recompute reactively as the fee selector changes.
  const kontorKind =
    asset?.type === "kor" ? "token" : asset?.type === "kontor-nft" ? "nft" : null;
  const kontorMiner = useKontorMinerFee(kontorKind, active && isKontor);
  const kontorMinerFeeSats =
    kontorMiner.revealVsize != null && feeRate != null
      ? estimateKontorMinerFee(kontorMiner.revealVsize, feeRate)
      : null;
  const kontorTotalSats =
    kontorFee.listingSats != null && kontorMinerFeeSats != null
      ? kontorFee.listingSats + kontorMinerFeeSats
      : null;

  // Block signing whenever the relevant fee preview failed: a failed estimate
  // (e.g. insufficient BTC to compose the transfer) means the real order can't
  // be composed either, so the "Sign" button stays disabled until it recovers.
  const canSign = isKontor ? kontorFee.error == null : preview.error == null;

  // The platform listing fee is waived when the server covered it via the
  // account's credit / subscription. PSBT listings report it on the sell-quote;
  // Kontor reports it on the fee-quote preview (the server honours credits for
  // Kontor too now). "1 credit" when a credit was spent, "Free" for a
  // subscription-only waiver.
  const feeWaived = isKontor ? kontorFee.feeWaived : preview.feeWaived;

  return {
    estimates,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor: (option) => rateForOption(option, estimates),
    btcUsd,
    isKontor,
    cost: preview.cost,
    feeWaived,
    paidWithCredit: feeWaived && hasCredit,
    previewLoading: preview.loading,
    previewError: preview.error,
    canSign,
    kontorListingSats: kontorFee.listingSats,
    kontorListingLoading: kontorFee.loading,
    kontorListingError: kontorFee.error,
    kontorMinerFeeSats,
    kontorTotalSats,
  };
}
