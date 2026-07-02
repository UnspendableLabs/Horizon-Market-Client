import { useState } from "react";
import { usePrices } from "../hooks/usePrices.js";
import { useFeeEstimates, type FeeEstimates } from "../hooks/useFeeEstimates.js";
import { useBuyQuotePreview } from "./useBuyQuotePreview.js";
import { type FeeOption, rateForOption } from "./feeRate.js";
import type { AtomicSwap } from "../../types/index.js";

export { FEE_OPTIONS, FEE_LABELS, type FeeOption } from "./feeRate.js";

export interface UseBuyReviewArgs {
  swap: AtomicSwap;
  defaultSatsPerVbyte?: number;
  /** Only compose the quote / fetch prices while the confirm step is shown. */
  active: boolean;
}

export interface UseBuyReviewResult {
  /** Live recommended fee rates (null until loaded). */
  estimates: FeeEstimates | null;
  feeOption: FeeOption;
  setFeeOption: (option: FeeOption) => void;
  /** Effective sat/vByte for the selected preset (undefined until estimates load). */
  feeRate: number | undefined;
  rateFor: (option: FeeOption) => number | undefined;
  /** BTC→USD price (null until loaded). */
  btcUsd: number | null;
  /** True for Kontor (KOR/NFT) listings — no server-side buy-quote to compose. */
  isKontor: boolean;
  /** Net sats the seller receives (exact, from the listing). */
  priceSats: number;
  /** Creator royalty in sats (from the composed quote, else the listing's value). */
  royaltySats: number | null;
  /** Buyer miner fee in sats (from the composed quote; null for Kontor / pending). */
  minerFeeSats: number | null;
  /** price + royalty + miner fee (null until the quote resolves). */
  totalSats: number | null;
  previewLoading: boolean;
  previewError: Error | null;
  /**
   * False when the quote couldn't be composed (e.g. insufficient BTC to fund the
   * purchase) — confirming would fail the same way, so the "Confirm" button stays
   * disabled until it recovers. Always true for Kontor (no preview).
   */
  canConfirm: boolean;
}

/**
 * Data layer for the buy review screen. Owns the fee-rate selection and combines
 * it with the live price and a debounced, side-effect-free quote preview so the
 * screen can show exactly what the buyer pays (price + royalty + miner fee) and
 * receives before they commit.
 */
export function useBuyReview({
  swap,
  defaultSatsPerVbyte,
  active,
}: UseBuyReviewArgs): UseBuyReviewResult {
  const { estimates } = useFeeEstimates();
  const { btcUsd } = usePrices();
  const [feeOption, setFeeOption] = useState<FeeOption>("normal");

  // Fall back to the caller's default (then the server default) until the live
  // estimates resolve.
  const feeRate = rateForOption(feeOption, estimates) ?? defaultSatsPerVbyte;

  const isKontor = swap.listingType === "kontor";
  const preview = useBuyQuotePreview(swap, feeRate, active);

  const priceSats = swap.price;
  const royaltySats = preview.royaltySats ?? swap.royalty;
  const minerFeeSats = preview.minerFeeSats;
  const totalSats =
    minerFeeSats != null
      ? priceSats + (royaltySats ?? 0) + minerFeeSats
      : null;

  // A failed compose means the real purchase can't be composed either.
  const canConfirm = isKontor ? true : preview.error == null;

  return {
    estimates,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor: (option) => rateForOption(option, estimates),
    btcUsd,
    isKontor,
    priceSats,
    royaltySats,
    minerFeeSats,
    totalSats,
    previewLoading: preview.loading,
    previewError: preview.error,
    canConfirm,
  };
}
