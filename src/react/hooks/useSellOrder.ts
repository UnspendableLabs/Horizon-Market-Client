import { useCallback, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  AtomicSwap,
  WorkflowProgressEvent,
} from "../../types/index.js";
import type { OpenSellOrderParams } from "../../workflows/sell.js";
import { CLIENT_NOT_INITIALIZED } from "../internal/format.js";
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
  confirmAndSell: () => Promise<void>;
  goBack: () => void;
  retry: () => void;
  reset: () => void;
  steps: WorkflowProgressEvent[];
  totalSteps: number | null;
  status: SellOrderStatus;
  result: SellOrderResult | null;
  error: Error | null;
}

function buildParams(
  values: SellOrderFormValues,
  defaultSatsPerVbyte?: number,
): OpenSellOrderParams {
  const asset = values.asset;
  if (!asset) throw new Error("No asset selected");

  const priceSats = Number(values.priceSats);
  if (!Number.isFinite(priceSats) || priceSats <= 0) {
    throw new Error("Invalid price");
  }

  const base = {
    priceSats,
    autoSelectFeeUtxos: true,
    ...(defaultSatsPerVbyte !== undefined
      ? { satsPerVbyte: defaultSatsPerVbyte }
      : {}),
  };

  if (asset.type === "ordinal") {
    return {
      ...base,
      listingType: "ordinal",
      assetUtxoId: asset.utxoId,
    };
  }

  if (!values.quantity) throw new Error("Quantity required");
  const quantity = BigInt(values.quantity);
  if (quantity <= 0n) throw new Error("Invalid quantity");

  if (asset.type === "zeld") {
    return {
      ...base,
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: quantity,
    };
  }

  return {
    ...base,
    listingType: "counterparty",
    assetName: asset.assetName,
    assetQuantity: quantity,
  };
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
  const [result, setResult] = useState<SellOrderResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const setFormValues = useCallback<UseSellOrderResult["setFormValues"]>(
    (update) => {
      setFormValuesState((prev) =>
        typeof update === "function" ? update(prev) : { ...prev, ...update },
      );
    },
    [],
  );

  const submitForm = useCallback(() => {
    try {
      buildParams(formValues);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    setError(null);
    setStep("confirm");
  }, [formValues]);

  const confirmAndSell = useCallback(async () => {
    if (!client) {
      const err = new Error(CLIENT_NOT_INITIALIZED);
      setError(err);
      setStatus("error");
      setStep("result");
      optsRef.current?.onError?.(err);
      return;
    }

    let params: OpenSellOrderParams;
    try {
      params = buildParams(formValues, optsRef.current?.defaultSatsPerVbyte);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setStatus("error");
      setStep("result");
      optsRef.current?.onError?.(e);
      return;
    }

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
  }, [client, formValues]);

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
    result,
    error,
  };
}
