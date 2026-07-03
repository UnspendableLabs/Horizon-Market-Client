import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  PendingSale,
  WorkflowProgressEvent,
} from "../../types/index.js";
import type { FillSwapsParams } from "../../workflows/buy.js";
import { CLIENT_NOT_INITIALIZED, mempoolTxUrl } from "../internal/format.js";

export type SwapConfirmationStep = "confirm" | "progress" | "result";
export type SwapConfirmationStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface UseSwapConfirmationOptions {
  swapId: string;
  /** Which flow this instance drives — selects the unified status/steps/message. */
  mode: "buy" | "sell";
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
  /** Status for the active `mode` (buy → buyStatus, sell → delistStatus). */
  status: SwapConfirmationStatus;
  /** Progress events for the active `mode`. */
  steps: WorkflowProgressEvent[];
  /** Total steps for the active `mode` (null until known). */
  totalSteps: number | null;
  /**
   * Result-screen success line for the active `mode`, or undefined until the
   * flow succeeds ("Purchase complete!" for buy, "Listing removed." for delist).
   */
  successMessage: string | undefined;
  /**
   * mempool.space link to the buy's settlement tx, or null. Only set on a
   * successful buy that produced a txid — lets the result screen present the tx
   * as a link instead of a truncated id, mirroring the sell confirmation.
   */
  trackUrl: string | null;
  sales: PendingSale[] | null;
  error: Error | null;
  isSubmitting: boolean;
  confirmPurchase: (extra?: Partial<FillSwapsParams>) => Promise<void>;
  delist: () => Promise<void>;
  retry: () => void;
  reset: () => void;
}

type Action =
  | { type: "buy"; params: Partial<FillSwapsParams> }
  | { type: "delist" };

const idleSwapState = {
  step: "confirm" as const,
  buyStatus: "idle" as const,
  delistStatus: "idle" as const,
  buySteps: [] as WorkflowProgressEvent[],
  delistSteps: [] as WorkflowProgressEvent[],
  totalBuySteps: null as number | null,
  totalDelistSteps: null as number | null,
  sales: null as PendingSale[] | null,
  error: null as Error | null,
  lastAction: null as Action | null,
};

export function useSwapConfirmation(
  options: UseSwapConfirmationOptions,
): UseSwapConfirmationResult {
  const { client, network, kontorNetwork } = useHorizonMarket();
  const { swapId, defaultSatsPerVbyte, mode } = options;

  const optsRef = useRef(options);
  optsRef.current = options;

  const [step, setStep] = useState<SwapConfirmationStep>(idleSwapState.step);
  const [buyStatus, setBuyStatus] = useState<SwapConfirmationStatus>(
    idleSwapState.buyStatus,
  );
  const [delistStatus, setDelistStatus] = useState<SwapConfirmationStatus>(
    idleSwapState.delistStatus,
  );
  const [buySteps, setBuySteps] = useState<WorkflowProgressEvent[]>(
    idleSwapState.buySteps,
  );
  const [delistSteps, setDelistSteps] = useState<WorkflowProgressEvent[]>(
    idleSwapState.delistSteps,
  );
  const [totalBuySteps, setTotalBuySteps] = useState<number | null>(
    idleSwapState.totalBuySteps,
  );
  const [totalDelistSteps, setTotalDelistSteps] = useState<number | null>(
    idleSwapState.totalDelistSteps,
  );
  const [sales, setSales] = useState<PendingSale[] | null>(idleSwapState.sales);
  const [error, setError] = useState<Error | null>(idleSwapState.error);
  const [lastAction, setLastAction] = useState<Action | null>(
    idleSwapState.lastAction,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submittingRef = useRef(false);

  // Defined before the swapId effect so the effect can call it directly,
  // eliminating the duplicated reset block.
  const reset = useCallback(() => {
    setStep(idleSwapState.step);
    setBuyStatus(idleSwapState.buyStatus);
    setDelistStatus(idleSwapState.delistStatus);
    setBuySteps(idleSwapState.buySteps);
    setDelistSteps(idleSwapState.delistSteps);
    setTotalBuySteps(idleSwapState.totalBuySteps);
    setTotalDelistSteps(idleSwapState.totalDelistSteps);
    setSales(idleSwapState.sales);
    setError(idleSwapState.error);
    setLastAction(idleSwapState.lastAction);
    setIsSubmitting(false);
    submittingRef.current = false;
  }, []);

  // Reset workflow state when the target swap changes.
  useEffect(() => {
    reset();
  }, [swapId, reset]);

  const confirmPurchase = useCallback(
    async (extra?: Partial<FillSwapsParams>) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      setLastAction({ type: "buy", params: extra ?? {} });

      try {
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
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [client, swapId, defaultSatsPerVbyte],
  );

  const delist = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setLastAction({ type: "delist" });

    try {
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
      setDelistStatus("loading");
      setStep("progress");

      try {
        await client.delistSwap(swapId, {
          onProgress: (event) => {
            setDelistSteps((prev) => [...prev, event]);
            if (event.totalSteps !== null) setTotalDelistSteps(event.totalSteps);
          },
        });
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
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [client, swapId]);

  const retry = useCallback(() => {
    if (!lastAction) return;
    if (lastAction.type === "buy") void confirmPurchase(lastAction.params);
    else void delist();
  }, [lastAction, confirmPurchase, delist]);

  // Unified view of the active flow so both renderers read one status/steps/
  // message instead of each re-selecting buy-vs-delist and rebuilding the label.
  const status = mode === "buy" ? buyStatus : delistStatus;
  const steps = mode === "buy" ? buySteps : delistSteps;
  const totalSteps = mode === "buy" ? totalBuySteps : totalDelistSteps;
  const successMessage =
    status === "success"
      ? mode === "buy"
        ? "Purchase complete!"
        : "Listing removed."
      : undefined;
  // On a successful buy, surface the settlement tx as a mempool.space link (see
  // the sell confirmation) instead of a truncated id baked into the message.
  const trackUrl =
    mode === "buy" && buyStatus === "success"
      ? mempoolTxUrl(network, kontorNetwork, sales?.[0]?.txId)
      : null;

  return {
    step,
    buyStatus,
    delistStatus,
    buySteps,
    delistSteps,
    totalBuySteps,
    totalDelistSteps,
    status,
    steps,
    totalSteps,
    successMessage,
    trackUrl,
    sales,
    error,
    isSubmitting,
    confirmPurchase,
    delist,
    retry,
    reset,
  };
}
