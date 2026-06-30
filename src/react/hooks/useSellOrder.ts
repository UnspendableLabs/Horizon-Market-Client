import { useCallback, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  AtomicSwap,
  WorkflowProgressEvent,
} from "../../types/index.js";
import { CLIENT_NOT_INITIALIZED } from "../internal/format.js";
import { buildSellOrderParams } from "../internal/sellFormValidation.js";
import type { OpenSellOrderParams } from "../../workflows/sell.js";
import type { AssetOption } from "./useAssets.js";

export type SellOrderStep = "form" | "confirm" | "progress" | "result";
export type SellOrderStatus = "idle" | "loading" | "success" | "error";

export interface SellOrderFormValues {
  asset: AssetOption | null;
  quantity: string;
  priceSats: string;
}

const initialForm: SellOrderFormValues = {
  asset: null,
  quantity: "",
  priceSats: "",
};

export interface SellOrderResult {
  swap: AtomicSwap;
  created: boolean;
}

export interface UseSellOrderOptions {
  defaultSatsPerVbyte?: number;
  onSuccess?: (swap: AtomicSwap, created: boolean) => void;
  onError?: (error: Error) => void;
}

export interface UseSellOrderResult {
  step: SellOrderStep;
  formValues: SellOrderFormValues;
  setFormValues: (
    update:
      | Partial<SellOrderFormValues>
      | ((prev: SellOrderFormValues) => SellOrderFormValues),
  ) => void;
  submitForm: () => void;
  confirmAndSell: (overrides?: { satsPerVbyte?: number }) => Promise<void>;
  goBack: () => void;
  retry: () => void;
  reset: () => void;
  steps: WorkflowProgressEvent[];
  totalSteps: number | null;
  status: SellOrderStatus;
  isSubmitting: boolean;
  result: SellOrderResult | null;
  error: Error | null;
}

export function useSellOrder(
  options?: UseSellOrderOptions,
): UseSellOrderResult {
  const { client } = useHorizonMarket();

  const optsRef = useRef(options);
  optsRef.current = options;

  const [step, setStep] = useState<SellOrderStep>("form");
  const [formValues, setFormValuesState] =
    useState<SellOrderFormValues>(initialForm);
  const [steps, setSteps] = useState<WorkflowProgressEvent[]>([]);
  const [totalSteps, setTotalSteps] = useState<number | null>(null);
  const [status, setStatus] = useState<SellOrderStatus>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SellOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const submittingRef = useRef(false);
  const confirmedParamsRef = useRef<OpenSellOrderParams | null>(null);

  const setFormValues = useCallback<UseSellOrderResult["setFormValues"]>(
    (update) => {
      setFormValuesState((prev) =>
        typeof update === "function" ? update(prev) : { ...prev, ...update },
      );
      setError(null);
    },
    [],
  );

  const submitForm = useCallback(() => {
    let params: OpenSellOrderParams;
    try {
      params = buildSellOrderParams(
        formValues,
        optsRef.current?.defaultSatsPerVbyte,
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    confirmedParamsRef.current = params;
    setError(null);
    setStep("confirm");
  }, [formValues]);

  const confirmAndSell = useCallback(async (overrides?: {
    satsPerVbyte?: number;
  }) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (!client) {
        const err = new Error(CLIENT_NOT_INITIALIZED);
        setError(err);
        setStatus("error");
        setStep("result");
        optsRef.current?.onError?.(err);
        return;
      }

      const base = confirmedParamsRef.current;
      if (!base) {
        const e = new Error("Form not submitted");
        setError(e);
        setStatus("error");
        setStep("result");
        optsRef.current?.onError?.(e);
        return;
      }

      // Apply the fee rate chosen on the review screen, then persist it so a
      // retry re-uses the same rate.
      const params: OpenSellOrderParams =
        overrides?.satsPerVbyte != null
          ? ({ ...base, satsPerVbyte: overrides.satsPerVbyte } as OpenSellOrderParams)
          : base;
      confirmedParamsRef.current = params;

      setSteps([]);
      setTotalSteps(null);
      setError(null);
      setResult(null);
      setStatus("loading");
      setStep("progress");

      try {
        const res = await client.openSellOrder(params, {
          onProgress: (event) => {
            setSteps((prev) => [...prev, event]);
            if (event.totalSteps !== null) setTotalSteps(event.totalSteps);
          },
        });
        setResult(res);
        setStatus("success");
        setStep("result");
        optsRef.current?.onSuccess?.(res.swap, res.created);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
        setStep("result");
        optsRef.current?.onError?.(e);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [client]);

  const goBack = useCallback(() => {
    if (step === "confirm") {
      setStep("form");
    } else if (step === "result" && status === "error") {
      setError(null);
      setStep("form");
    }
  }, [step, status]);

  const retry = useCallback(() => {
    if (status !== "error") return;
    void confirmAndSell();
  }, [status, confirmAndSell]);

  const reset = useCallback(() => {
    setStep("form");
    setFormValuesState(initialForm);
    setSteps([]);
    setTotalSteps(null);
    setStatus("idle");
    setIsSubmitting(false);
    submittingRef.current = false;
    confirmedParamsRef.current = null;
    setResult(null);
    setError(null);
  }, []);

  return {
    step,
    formValues,
    setFormValues,
    submitForm,
    confirmAndSell,
    goBack,
    retry,
    reset,
    steps,
    totalSteps,
    status,
    isSubmitting,
    result,
    error,
  };
}
