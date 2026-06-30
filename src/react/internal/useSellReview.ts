import { useMemo, useState } from "react";
import { usePrices } from "../hooks/usePrices.js";
import { useFeeEstimates, type FeeEstimates } from "../hooks/useFeeEstimates.js";
import { useSellQuotePreview, type SellCost } from "./useSellQuotePreview.js";
import { useKontorListingFee } from "./useKontorListingFee.js";
import { useKontorMinerFee } from "./useKontorMinerFee.js";
import { estimateKontorMinerFee } from "./kontorFeeEstimate.js";
import { buildSellOrderParams } from "./sellFormValidation.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";
import type { OpenSellOrderParams } from "../../workflows/sell.js";

/** Preset speed for the sell review's fee-rate selector. */
export type FeeOption = "slow" | "normal" | "fast";

export const FEE_OPTIONS: FeeOption[] = ["slow", "normal", "fast"];

function rateForOption(
  option: FeeOption,
  estimates: FeeEstimates | null,
): number | undefined {
  if (!estimates) return undefined;
  if (option === "fast") return estimates.fastestFee;
  if (option === "slow") return estimates.hourFee;
  return estimates.halfHourFee;
}

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
  previewLoading: boolean;
  previewError: Error | null;
  /** Kontor listing fee in sats (null until loaded). Only set for KOR/NFT. */
  kontorListingSats: number | null;
  kontorListingLoading: boolean;
  /** Estimated Kontor attach miner fee in sats (≈, scales with feeRate). */
  kontorMinerFeeSats: number | null;
  /** Estimated Kontor total (listing + miner fee) in sats (≈). */
  kontorTotalSats: number | null;
  /** True when the miner-fee vsize was measured from a live same-kind listing. */
  kontorMinerCalibrated: boolean;
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
  const [feeOption, setFeeOption] = useState<FeeOption>("normal");

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

  return {
    estimates,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor: (option) => rateForOption(option, estimates),
    btcUsd,
    isKontor,
    cost: preview.cost,
    feeWaived: preview.feeWaived,
    previewLoading: preview.loading,
    previewError: preview.error,
    kontorListingSats: kontorFee.listingSats,
    kontorListingLoading: kontorFee.loading,
    kontorMinerFeeSats,
    kontorTotalSats,
    kontorMinerCalibrated: kontorMiner.calibrated,
  };
}
