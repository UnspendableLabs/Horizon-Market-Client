/** Workflow identifier for progress events. */
export type WorkflowName =
  | "openSellOrder"
  | "fillSwaps"
  | "delistSwap"
  | "createToken";

/** Phase of a workflow step. */
export type WorkflowProgressPhase = "start" | "complete" | "error";

/** Steps emitted during `openSellOrder`. */
export type OpenSellOrderStep =
  | "validateParams"
  | "requestSellQuote"
  | "signPrepPsbt"
  | "finalizePrepPsbt"
  | "signSwapPsbt"
  | "signFeePsbt"
  | "createSwap"
  // Kontor (listingType: "kontor")
  | "preflightKontor"
  | "reserveKontorFee"
  | "composeKontorOffer";

/** Steps emitted during `fillSwaps`. */
export type FillSwapsStep =
  | "validateParams"
  | "requestBuyQuote"
  | "signBuyerPsbt"
  | "submitPurchase"
  // Kontor
  | "preflightKontor"
  | "inspectKontorOffer"
  | "acceptKontorOffer";

/** Steps emitted during `delistSwap`. */
export type DelistSwapStep =
  | "startDelist"
  | "signDelistMessage"
  | "confirmDelist"
  // Kontor
  | "preflightKontor"
  | "revokeKontorOffer";

/** Steps emitted during `createToken`. */
export type CreateTokenStep =
  | "validateParams"
  // Skipped when the caller already holds a quote (the confirm-modal flow).
  | "requestCreationQuote"
  | "signCreationPsbt"
  | "submitCreation";

export type WorkflowStep =
  | OpenSellOrderStep
  | FillSwapsStep
  | DelistSwapStep
  | CreateTokenStep;

/** Map a workflow name to its step union. */
export type WorkflowStepFor<W extends WorkflowName> = W extends "openSellOrder"
  ? OpenSellOrderStep
  : W extends "fillSwaps"
    ? FillSwapsStep
    : W extends "delistSwap"
      ? DelistSwapStep
      : W extends "createToken"
        ? CreateTokenStep
        : never;

/** Optional per-workflow options (e.g. progress reporting). */
export interface WorkflowOptions {
  onProgress?: (event: WorkflowProgressEvent) => void;
}

interface WorkflowProgressEventBase {
  /** Human-readable status for UI display. */
  message: string;
  /** 1-based index of the current step in this execution. */
  stepIndex: number;
  /**
   * Total steps for this execution.
   * `null` only before the step plan is known (early openSellOrder events).
   */
  totalSteps: number | null;
  phase: WorkflowProgressPhase;
}

/**
 * Progress event emitted at the start, completion, or failure of a workflow step.
 *
 * Discriminated on `workflow` — narrow on `event.workflow` to type-refine `event.step`.
 */
export type WorkflowProgressEvent =
  | (WorkflowProgressEventBase & {
      workflow: "openSellOrder";
      step: OpenSellOrderStep;
    })
  | (WorkflowProgressEventBase & {
      workflow: "fillSwaps";
      step: FillSwapsStep;
    })
  | (WorkflowProgressEventBase & {
      workflow: "delistSwap";
      step: DelistSwapStep;
    })
  | (WorkflowProgressEventBase & {
      workflow: "createToken";
      step: CreateTokenStep;
    });
