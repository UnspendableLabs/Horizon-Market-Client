import { useCallback, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  PendingSale,
  WorkflowProgressEvent,
} from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { CLIENT_NOT_INITIALIZED } from "../internal/format.js";

export type SwapConfirmationStep = "confirm" | "progress" | "result";
export type SwapConfirmationStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface UseSwapConfirmationOptions {
  swapId: string;
  defaultSatsPerVbyte?: number;
  onBuySuccess?: (sales: PendingSale[]) => void;
  onDelistSuccess?: () => void;
  onError?: (error: Error) => void;
}

export interface UseSwapConfirmationResult {
  step: SwapConfirmationStep;
  buyStatus: SwapConfirmationStatus;
  delistStatus: SwapConfirmationStatus;
  buySteps: WorkflowProgressEvent[];
  delistSteps: WorkflowProgressEvent[];
  totalBuySteps: number | null;
  totalDelistSteps: number | null;
  sales: PendingSale[] | null;
  delisted: boolean;
  error: Error | null;
  confirmPurchase: (extra?: Partial<FillSwapsParams>) => Promise<void>;
  delist: () => Promise<void>;
  retry: () => void;
  reset: () => void;
}

type Action =
  | { type: "buy"; params: Partial<FillSwapsParams> }
  | { type: "delist" };

export function useSwapConfirmation(
  options: UseSwapConfirmationOptions,
): UseSwapConfirmationResult {
  const { client } = useHorizonMarket();
  const { swapId, defaultSatsPerVbyte } = options;

  const optsRef = useRef(options);
  optsRef.current = options;

  const [step, setStep] = useState<SwapConfirmationStep>("confirm");
  const [buyStatus, setBuyStatus] = useState<SwapConfirmationStatus>("idle");
  const [delistStatus, setDelistStatus] =
    useState<SwapConfirmationStatus>("idle");
  const [buySteps, setBuySteps] = useState<WorkflowProgressEvent[]>([]);
  const [delistSteps, setDelistSteps] = useState<WorkflowProgressEvent[]>([]);
  const [totalBuySteps, setTotalBuySteps] = useState<number | null>(null);
  const [totalDelistSteps, setTotalDelistSteps] = useState<number | null>(
    null,
  );
  const [sales, setSales] = useState<PendingSale[] | null>(null);
  const [delisted, setDelisted] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastAction, setLastAction] = useState<Action | null>(null);

  const confirmPurchase = useCallback(
    async (extra?: Partial<FillSwapsParams>) => {
      if (!client) {
        const err = new Error(CLIENT_NOT_INITIALIZED);
        setError(err);
        setBuyStatus("error");
        setStep("result");
        optsRef.current.onError?.(err);
        return;
      }
      setBuySteps([]);
      setTotalBuySteps(null);
      setError(null);
      setSales(null);
      setBuyStatus("loading");
      setStep("progress");
      setLastAction({ type: "buy", params: extra ?? {} });

      try {
        const params: FillSwapsParams = {
          swapIds: [swapId],
          autoSelect: true,
          ...(defaultSatsPerVbyte !== undefined
            ? { satsPerVbyte: defaultSatsPerVbyte }
            : {}),
          ...(extra ?? {}),
        };
        const result = await client.fillSwaps(params, {
          onProgress: (event) => {
            setBuySteps((prev) => [...prev, event]);
            if (event.totalSteps !== null) setTotalBuySteps(event.totalSteps);
          },
        });
        setSales(result);
        setBuyStatus("success");
        setStep("result");
        optsRef.current.onBuySuccess?.(result);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setBuyStatus("error");
        setStep("result");
        optsRef.current.onError?.(e);
      }
    },
    [client, swapId, defaultSatsPerVbyte],
  );

  const delist = useCallback(async () => {
    if (!client) {
      const err = new Error(CLIENT_NOT_INITIALIZED);
      setError(err);
      setDelistStatus("error");
      setStep("result");
      optsRef.current.onError?.(err);
      return;
    }
    setDelistSteps([]);
    setTotalDelistSteps(null);
    setError(null);
    setDelisted(false);
    setDelistStatus("loading");
    setStep("progress");
    setLastAction({ type: "delist" });

    try {
      await client.delistSwap(swapId, {
        onProgress: (event) => {
          setDelistSteps((prev) => [...prev, event]);
          if (event.totalSteps !== null) setTotalDelistSteps(event.totalSteps);
        },
      });
      setDelisted(true);
      setDelistStatus("success");
      setStep("result");
      optsRef.current.onDelistSuccess?.();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setDelistStatus("error");
      setStep("result");
      optsRef.current.onError?.(e);
    }
  }, [client, swapId]);

  const retry = useCallback(() => {
    if (!lastAction) return;
    if (lastAction.type === "buy") void confirmPurchase(lastAction.params);
    else void delist();
  }, [lastAction, confirmPurchase, delist]);

  const reset = useCallback(() => {
    setStep("confirm");
    setBuyStatus("idle");
    setDelistStatus("idle");
    setBuySteps([]);
    setDelistSteps([]);
    setTotalBuySteps(null);
    setTotalDelistSteps(null);
    setSales(null);
    setDelisted(false);
    setError(null);
    setLastAction(null);
  }, []);

  return {
    step,
    buyStatus,
    delistStatus,
    buySteps,
    delistSteps,
    totalBuySteps,
    totalDelistSteps,
    sales,
    delisted,
    error,
    confirmPurchase,
    delist,
    retry,
    reset,
  };
}
