import { useCallback, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import {
  CLIENT_NOT_INITIALIZED,
  formatUsd,
  sellingDisplay,
} from "../internal/format.js";
import type { PreparedSend, SendKind, SendRequest } from "../../client.js";
import type { KontorAssetKind } from "../../types/index.js";
import { useKontorMinerFee } from "../internal/useKontorMinerFee.js";
import { estimateKontorMinerFee } from "../internal/kontorFeeEstimate.js";
import { usePrices } from "./usePrices.js";
import { useAssets, type AssetOption } from "./useAssets.js";
import { useFeeEstimates, type FeeEstimates } from "./useFeeEstimates.js";

/** The asset a withdraw targets: a wallet BTC balance or an owned asset. */
export type WithdrawTarget =
  | { type: "btc"; balanceSats: bigint | null }
  | AssetOption;

export type WithdrawStep = "form" | "confirm" | "progress" | "result";
export type WithdrawStatus = "idle" | "loading" | "success" | "error";

/** Preset fee-rate speed, chosen on the form step (mirrors the sell review). */
export type WithdrawFeeOption = "slow" | "normal" | "fast";

export const WITHDRAW_FEE_OPTIONS: WithdrawFeeOption[] = [
  "slow",
  "normal",
  "fast",
];

/** Display labels for the withdraw fee-rate presets (shared by both renderers). */
export const WITHDRAW_FEE_LABELS: Record<WithdrawFeeOption, string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
};

function rateForOption(
  option: WithdrawFeeOption,
  estimates: FeeEstimates | null,
): number | undefined {
  if (!estimates) return undefined;
  if (option === "fast") return estimates.fastestFee;
  if (option === "slow") return estimates.hourFee;
  return estimates.halfHourFee;
}

export interface WithdrawFormValues {
  /** Recipient address (bitcoin address, or P2TR for Kontor). */
  destination: string;
  /** Human amount for fungibles; ignored for ordinals / NFTs. */
  quantity: string;
}

export interface WithdrawResult {
  txid: string;
}

/** Resolved network-fee view for the review step (exact for BTC, estimated for Kontor). */
export interface WithdrawReviewFee {
  /** True when `sats` is the composed tx's exact fee (Bitcoin family). */
  exact: boolean;
  /** Fee in sats — exact for BTC, estimated for Kontor, null until known. */
  sats: number | null;
  /** Formatted USD value of `sats`, or null. */
  usd: string | null;
}

export interface UseWithdrawOptions {
  target: WithdrawTarget;
  onSuccess?: (txid: string) => void;
  onError?: (error: Error) => void;
}

export interface UseWithdrawResult {
  target: WithdrawTarget;
  kind: SendKind;
  /** True for KOR / NFT — the miner fee is set by Kontor, not chosen here. */
  isKontor: boolean;
  /** Symbol / name / id shown in the UI (e.g. "BTC", "XCP", nftId). */
  assetLabel: string;
  /** False for 1-of-1 assets (ordinal, NFT) — the quantity field is hidden. */
  needsQuantity: boolean;
  /** Human-readable available balance for the target, or null. */
  availableDisplay: string | null;
  /** Field label for the destination input (P2TR wording for Kontor). */
  destinationLabel: string;
  /** Placeholder for the destination input ("tb1p…" for Kontor, else "bc1…"). */
  destinationPlaceholder: string;
  /** Name + sub line for the review's "You're withdrawing" block. */
  withdrawingDisplay: { name: string; sub: string | null };
  /** Resolved network-fee view for the review step. */
  reviewFee: WithdrawReviewFee;
  /** True when the form can't yet be submitted (composing, or required fields empty). */
  submitDisabled: boolean;
  formValues: WithdrawFormValues;
  setFormValues: (update: Partial<WithdrawFormValues>) => void;
  /** Selected fee-rate speed preset (form step). */
  feeOption: WithdrawFeeOption;
  setFeeOption: (option: WithdrawFeeOption) => void;
  /** Effective sat/vByte for the selected preset (null until estimates load). */
  feeRate: number | null;
  /** sat/vByte for a given preset, for labelling the selector. */
  rateFor: (option: WithdrawFeeOption) => number | undefined;
  feeEstimates: FeeEstimates | null;
  step: WithdrawStep;
  status: WithdrawStatus;
  /** Composing the transaction for the review step (form → confirm). */
  isPreparing: boolean;
  /** Exact miner fee (sats) of the composed tx, or null (Kontor / not composed). */
  feeSats: bigint | null;
  /**
   * Estimated Kontor miner fee (sats) at the selected rate — an approximation
   * (reveal vsize × rate, like the sell review), since Kontor sets the exact
   * fee at submit. Null for the Bitcoin family (they carry an exact `feeSats`).
   */
  estimatedFeeSats: number | null;
  /** True when the Kontor estimate was calibrated from a live same-kind listing. */
  feeEstimateCalibrated: boolean;
  isSubmitting: boolean;
  submitForm: () => void;
  confirmAndSend: () => Promise<void>;
  goBack: () => void;
  retry: () => void;
  reset: () => void;
  result: WithdrawResult | null;
  error: Error | null;
}

const ZERO = 0n;

function targetKind(target: WithdrawTarget): SendKind {
  return target.type;
}

function isKontorKind(kind: SendKind): boolean {
  return kind === "kor" || kind === "kontor-nft";
}

function needsQuantityFor(kind: SendKind): boolean {
  return kind !== "ordinal" && kind !== "kontor-nft";
}

function assetLabelFor(target: WithdrawTarget): string {
  switch (target.type) {
    case "btc":
      return "BTC";
    case "counterparty":
      return target.assetName;
    case "zeld":
      return "ZELD";
    case "kor":
      return "KOR";
    case "ordinal":
      return shorten(target.inscriptionId);
    case "kontor-nft":
      return target.nftId;
  }
}

function shorten(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

function formatSatsAsBtc(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = (sats % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

/** Name + sub line for the review's "You're withdrawing" block. */
function targetDisplay(
  target: WithdrawTarget,
  quantity: string,
): { name: string; sub: string | null } {
  if (target.type === "btc") {
    return { name: "BTC", sub: `${quantity || "0"} BTC` };
  }
  return sellingDisplay(target, quantity);
}

function availableFor(target: WithdrawTarget): string | null {
  switch (target.type) {
    case "btc":
      return target.balanceSats === null
        ? null
        : formatSatsAsBtc(target.balanceSats);
    case "counterparty":
    case "zeld":
      return target.quantityNormalized;
    case "kor":
      return target.amount;
    case "ordinal":
    case "kontor-nft":
      return null;
  }
}

/**
 * Parse a decimal string into base units. `decimals = 0` requires a whole number
 * (indivisible assets). Throws on malformed input or excess precision.
 */
function decimalToBaseUnits(value: string, decimals: number): bigint {
  const s = value.trim();
  if (s === "" || s === "." || !/^\d*(\.\d*)?$/.test(s)) {
    throw new Error("Enter a valid amount");
  }
  const [intPart, fracPart = ""] = s.split(".");
  if (decimals === 0) {
    if (fracPart.replace(/0+$/, "") !== "") {
      throw new Error("This asset is indivisible — enter a whole number");
    }
    return BigInt(intPart || "0");
  }
  if (fracPart.length > decimals) {
    throw new Error(`At most ${decimals} decimal places`);
  }
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/**
 * Build the {@link SendRequest} for a target + form values. `satsPerVbyte` is
 * ignored by the Kontor branches (they let the SDK/indexer pick a rate when
 * omitted, but we still forward it as a hint).
 */
function buildRequest(
  target: WithdrawTarget,
  destination: string,
  quantity: string,
  satsPerVbyte: number,
): SendRequest {
  const toAddress = destination.trim();
  if (!toAddress) throw new Error("Enter a destination address");

  switch (target.type) {
    case "btc": {
      const amountSats = decimalToBaseUnits(quantity, 8);
      if (amountSats <= ZERO) throw new Error("Enter an amount greater than 0");
      return { kind: "btc", toAddress, amountSats, satsPerVbyte };
    }
    case "counterparty": {
      const q = decimalToBaseUnits(quantity, target.divisible ? 8 : 0);
      if (q <= ZERO) throw new Error("Enter an amount greater than 0");
      if (q > target.balance) throw new Error("Amount exceeds your balance");
      return {
        kind: "counterparty",
        fromAddress: target.address,
        asset: target.assetName,
        toAddress,
        quantity: q,
        divisible: target.divisible,
        satsPerVbyte,
      };
    }
    case "zeld": {
      const amount = decimalToBaseUnits(quantity, 8);
      if (amount <= ZERO) throw new Error("Enter an amount greater than 0");
      if (amount > target.balance) throw new Error("Amount exceeds your balance");
      return { kind: "zeld", fromAddress: target.address, toAddress, amount, satsPerVbyte };
    }
    case "ordinal":
      return {
        kind: "ordinal",
        fromAddress: target.address,
        utxoId: target.utxoId,
        toAddress,
        satsPerVbyte,
      };
    case "kor": {
      const trimmed = quantity.trim();
      if (!trimmed || Number(trimmed) <= 0) {
        throw new Error("Enter an amount greater than 0");
      }
      return { kind: "kor", toAddress, amount: trimmed, satsPerVbyte };
    }
    case "kontor-nft":
      return {
        kind: "kontor-nft",
        contractAddress: target.contractAddress,
        nftId: target.nftId,
        toAddress,
        satsPerVbyte,
      };
  }
}

/**
 * Drives the wallet withdraw (send) flow for a single asset target through
 * `form → confirm → progress → result`, mirroring {@link useSellOrder}.
 *
 * The fee rate is chosen on the form step. Moving to the review step *composes
 * and signs* the transaction via `client.prepareSend(...)` — the resulting
 * {@link PreparedSend} carries the exact miner fee shown on review; `confirm`
 * just broadcasts it. The wallet's inscription UTXO ids are passed as
 * `protectedUtxoIds` so plain-BTC funding never spends an ordinal.
 */
export function useWithdraw(options: UseWithdrawOptions): UseWithdrawResult {
  const { client } = useHorizonMarket();
  const { ordinals, refresh: refreshAssets } = useAssets();
  const { estimates } = useFeeEstimates();
  const { btcUsd } = usePrices();

  const optsRef = useRef(options);
  optsRef.current = options;
  const target = options.target;
  const kind = targetKind(target);
  const isKontor = isKontorKind(kind);
  const needsQuantity = needsQuantityFor(kind);

  const [formValues, setFormValuesState] = useState<WithdrawFormValues>({
    destination: "",
    quantity: "",
  });
  const [feeOption, setFeeOptionState] = useState<WithdrawFeeOption>("normal");
  const [step, setStep] = useState<WithdrawStep>("form");
  const [status, setStatus] = useState<WithdrawStatus>("idle");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feeSats, setFeeSats] = useState<bigint | null>(null);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const preparingRef = useRef(false);
  const submittingRef = useRef(false);
  const preparedRef = useRef<PreparedSend | null>(null);

  // Effective fee rate for the selected preset; falls back to the half-hour
  // estimate, then 1 sat/vB, until the live estimates resolve.
  const feeRate = rateForOption(feeOption, estimates) ?? null;

  // Kontor can't be pre-composed, so — like the sell review — estimate its miner
  // fee as (reveal vsize × selected rate). The vsize is calibrated from a live
  // same-kind listing, falling back to a baked value.
  const kontorKind: KontorAssetKind | null =
    kind === "kor" ? "token" : kind === "kontor-nft" ? "nft" : null;
  const kontorMiner = useKontorMinerFee(kontorKind, isKontor);
  const estimatedFeeSats =
    isKontor && kontorMiner.revealVsize != null && feeRate != null
      ? estimateKontorMinerFee(kontorMiner.revealVsize, feeRate)
      : null;

  const setFormValues = useCallback((update: Partial<WithdrawFormValues>) => {
    setFormValuesState((prev) => ({ ...prev, ...update }));
    setError(null);
  }, []);

  const setFeeOption = useCallback((option: WithdrawFeeOption) => {
    setFeeOptionState(option);
    setError(null);
  }, []);

  // Compose + sign the transaction, then advance to the review step so the exact
  // miner fee can be shown. Kept as a `void`-returning callback (fire-and-forget).
  const submitForm = useCallback(() => {
    if (preparingRef.current) return;
    const rate = rateForOption(feeOption, estimates) ?? 1;
    let request: SendRequest;
    try {
      request = buildRequest(
        target,
        formValues.destination,
        needsQuantity ? formValues.quantity : "",
        rate,
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!client) {
      setError(new Error(CLIENT_NOT_INITIALIZED));
      return;
    }

    preparingRef.current = true;
    setIsPreparing(true);
    setError(null);
    preparedRef.current = null;
    setFeeSats(null);

    void (async () => {
      try {
        const prepared = await client.prepareSend(request, {
          protectedUtxoIds: ordinals.flatMap((o) =>
            o.type === "ordinal" ? [o.utxoId] : [],
          ),
        });
        preparedRef.current = prepared;
        setFeeSats(prepared.feeSats);
        setStep("confirm");
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        preparingRef.current = false;
        setIsPreparing(false);
      }
    })();
  }, [client, target, formValues, needsQuantity, feeOption, estimates, ordinals]);

  const confirmAndSend = useCallback(async () => {
    if (submittingRef.current) return;
    const prepared = preparedRef.current;
    if (!prepared) {
      const err = new Error("No composed transaction to send — please review again");
      setError(err);
      setStatus("error");
      setStep("result");
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    setStatus("loading");
    setStep("progress");
    try {
      const res = await prepared.broadcast();
      setResult(res);
      setStatus("success");
      setStep("result");
      optsRef.current.onSuccess?.(res.txid);
      // The balance just changed — refresh the owned-assets cache.
      refreshAssets();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setStatus("error");
      setStep("result");
      optsRef.current.onError?.(e);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [refreshAssets]);

  const goBack = useCallback(() => {
    if (step === "confirm") {
      preparedRef.current = null;
      setFeeSats(null);
      setStep("form");
    } else if (step === "result" && status === "error") {
      setError(null);
      setStep("form");
    }
  }, [step, status]);

  // On a broadcast failure the composed tx may be stale (e.g. spent inputs), so
  // retry re-composes from the form rather than re-broadcasting.
  const retry = useCallback(() => {
    if (status !== "error") return;
    preparedRef.current = null;
    setFeeSats(null);
    setError(null);
    setStatus("idle");
    setStep("form");
  }, [status]);

  const reset = useCallback(() => {
    setFormValuesState({ destination: "", quantity: "" });
    setFeeOptionState("normal");
    setStep("form");
    setStatus("idle");
    setIsPreparing(false);
    setIsSubmitting(false);
    preparingRef.current = false;
    submittingRef.current = false;
    preparedRef.current = null;
    setFeeSats(null);
    setResult(null);
    setError(null);
  }, []);

  const assetLabel = useMemo(() => assetLabelFor(target), [target]);
  const availableDisplay = useMemo(() => availableFor(target), [target]);

  const destinationLabel = isKontor
    ? "Recipient (P2TR address)"
    : "Destination address";
  const destinationPlaceholder = isKontor ? "tb1p…" : "bc1…";
  const withdrawingDisplay = targetDisplay(target, formValues.quantity);
  const submitDisabled =
    isPreparing ||
    !formValues.destination.trim() ||
    (needsQuantity && !formValues.quantity.trim());

  // Bitcoin family: the exact fee from the composed tx. Kontor: an estimate at
  // the selected rate (the SDK finalises the exact fee at submit).
  const reviewFeeExact = !isKontor && feeSats != null;
  const reviewFeeSats = isKontor
    ? estimatedFeeSats
    : feeSats != null
      ? Number(feeSats)
      : null;
  const reviewFee: WithdrawReviewFee = {
    exact: reviewFeeExact,
    sats: reviewFeeSats,
    usd: reviewFeeSats != null ? formatUsd(reviewFeeSats, btcUsd) : null,
  };

  return {
    target,
    kind,
    isKontor,
    assetLabel,
    needsQuantity,
    availableDisplay,
    destinationLabel,
    destinationPlaceholder,
    withdrawingDisplay,
    reviewFee,
    submitDisabled,
    formValues,
    setFormValues,
    feeOption,
    setFeeOption,
    feeRate,
    rateFor: (option) => rateForOption(option, estimates),
    feeEstimates: estimates,
    step,
    status,
    isPreparing,
    feeSats,
    estimatedFeeSats,
    feeEstimateCalibrated: kontorMiner.calibrated,
    isSubmitting,
    submitForm,
    confirmAndSend,
    goBack,
    retry,
    reset,
    result,
    error,
  };
}
