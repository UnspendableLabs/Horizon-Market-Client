import type { FeeEstimates } from "../hooks/useFeeEstimates.js";

/** Preset speed for a review screen's fee-rate selector. */
export type FeeOption = "slow" | "normal" | "fast";

export const FEE_OPTIONS: FeeOption[] = ["slow", "normal", "fast"];

export const FEE_LABELS: Record<FeeOption, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

/** sat/vByte for the given preset, or undefined until live estimates load. */
export function rateForOption(
  option: FeeOption,
  estimates: FeeEstimates | null,
): number | undefined {
  if (!estimates) return undefined;
  if (option === "fast") return estimates.fastestFee;
  if (option === "slow") return estimates.hourFee;
  return estimates.halfHourFee;
}
