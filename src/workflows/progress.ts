import type {
  WorkflowName,
  WorkflowOptions,
  WorkflowProgressEvent,
  WorkflowProgressPhase,
  WorkflowStepFor,
} from "../types/progress.js";

export interface StepMessages {
  start: string;
  complete: string;
  error: string;
}

type WorkflowStepMessages<W extends WorkflowName> = Record<
  WorkflowStepFor<W>,
  StepMessages
>;

type AllStepMessages = {
  [W in WorkflowName]: WorkflowStepMessages<W>;
};

const STEP_MESSAGES: AllStepMessages = {
  openSellOrder: {
    validateParams: {
      start: "Validating sell parameters…",
      complete: "Sell parameters validated",
      error: "Sell parameter validation failed",
    },
    requestSellQuote: {
      start: "Requesting sell quote…",
      complete: "Sell quote received",
      error: "Sell quote request failed",
    },
    signPrepPsbt: {
      start: "Signing prep PSBT…",
      complete: "Prep PSBT signed",
      error: "Prep PSBT signing failed",
    },
    finalizePrepPsbt: {
      start: "Finalizing prep transaction…",
      complete: "Prep transaction finalized",
      error: "Prep transaction finalization failed",
    },
    signSwapPsbt: {
      start: "Signing swap PSBT…",
      complete: "Swap PSBT signed",
      error: "Swap PSBT signing failed",
    },
    signFeePsbt: {
      start: "Signing fee PSBT…",
      complete: "Fee PSBT signed",
      error: "Fee PSBT signing failed",
    },
    createSwap: {
      start: "Creating listing…",
      complete: "Listing created",
      error: "Listing creation failed",
    },
    preflightKontor: {
      start: "Checking Kontor gas balance and asset…",
      complete: "Kontor account and asset ready",
      error: "Kontor pre-flight check failed",
    },
    reserveKontorFee: {
      start: "Reserving Kontor listing fee…",
      complete: "Kontor listing fee reserved",
      error: "Kontor fee reservation failed",
    },
    composeKontorOffer: {
      start: "Escrowing asset and composing offer…",
      complete: "Kontor offer composed",
      error: "Kontor offer composition failed",
    },
  },
  fillSwaps: {
    validateParams: {
      start: "Validating buy parameters…",
      complete: "Buy parameters validated",
      error: "Buy parameter validation failed",
    },
    requestBuyQuote: {
      start: "Requesting buy quote…",
      complete: "Buy quote received",
      error: "Buy quote request failed",
    },
    signBuyerPsbt: {
      start: "Signing buyer PSBT…",
      complete: "Buyer PSBT signed",
      error: "Buyer PSBT signing failed",
    },
    submitPurchase: {
      start: "Submitting purchase…",
      complete: "Purchase submitted",
      error: "Purchase submission failed",
    },
    preflightKontor: {
      start: "Checking Kontor gas balance and escrow…",
      complete: "Kontor account and escrow verified",
      error: "Kontor pre-flight check failed",
    },
    inspectKontorOffer: {
      start: "Inspecting Kontor offer…",
      complete: "Kontor offer valid",
      error: "Kontor offer inspection failed",
    },
    acceptKontorOffer: {
      start: "Accepting offer and broadcasting swap…",
      complete: "Kontor swap broadcast",
      error: "Kontor swap acceptance failed",
    },
  },
  delistSwap: {
    startDelist: {
      start: "Starting delist request…",
      complete: "Delist request started",
      error: "Delist request failed",
    },
    signDelistMessage: {
      start: "Signing delist message (BIP322)…",
      complete: "Delist message signed",
      error: "Delist message signing failed",
    },
    confirmDelist: {
      start: "Confirming delist…",
      complete: "Delist confirmed",
      error: "Delist confirmation failed",
    },
    preflightKontor: {
      start: "Checking Kontor gas balance…",
      complete: "Kontor account ready",
      error: "Kontor pre-flight check failed",
    },
    revokeKontorOffer: {
      start: "Revoking Kontor offer and reclaiming asset…",
      complete: "Kontor offer revoked",
      error: "Kontor offer revocation failed",
    },
  },
  // Protocol-neutral wording: one screen creates a Counterparty asset and an
  // ordinal inscription, and the steps are the same either way.
  createToken: {
    validateParams: {
      start: "Validating token details…",
      complete: "Token details validated",
      error: "Token detail validation failed",
    },
    requestCreationQuote: {
      start: "Composing the transaction…",
      complete: "Transaction composed",
      error: "Composing the transaction failed",
    },
    signCreationPsbt: {
      start: "Signing transaction…",
      complete: "Transaction signed",
      error: "Transaction signing failed",
    },
    submitCreation: {
      start: "Broadcasting…",
      complete: "Token created",
      error: "Broadcast failed",
    },
  },
};

/**
 * The `{ start, complete, error }` labels for one step of a workflow. Exposed so
 * a caller replaying a single step outside a {@link WorkflowProgressReporter}
 * (e.g. the record-only retry of a Kontor purchase) emits identical text.
 */
export function stepMessages<W extends WorkflowName>(
  workflow: W,
  step: WorkflowStepFor<W>,
): StepMessages {
  return STEP_MESSAGES[workflow][step];
}

/**
 * Emits step-level progress events for a workflow.
 *
 * Each `runSync` / `runAsync` call counts as one step and emits a `start` event,
 * then a `complete` event (or `error` if the wrapped function throws).
 * `totalSteps` can be set at construction or later via `setTotalSteps` once
 * the step plan is known.
 */
export class WorkflowProgressReporter<W extends WorkflowName> {
  private stepIndex = 0;
  private totalSteps: number | null;

  constructor(
    private readonly workflow: W,
    private readonly onProgress?: WorkflowOptions["onProgress"],
    totalSteps: number | null = null,
  ) {
    this.totalSteps = totalSteps;
  }

  setTotalSteps(totalSteps: number): void {
    this.totalSteps = totalSteps;
  }

  async runAsync<T>(step: WorkflowStepFor<W>, fn: () => Promise<T>): Promise<T> {
    this.stepIndex++;
    this.emit(step, "start");
    try {
      const result = await fn();
      this.emit(step, "complete");
      return result;
    } catch (err) {
      this.emit(step, "error");
      throw err;
    }
  }

  runSync<T>(step: WorkflowStepFor<W>, fn: () => T): T {
    this.stepIndex++;
    this.emit(step, "start");
    try {
      const result = fn();
      this.emit(step, "complete");
      return result;
    } catch (err) {
      this.emit(step, "error");
      throw err;
    }
  }

  /**
   * Notify the host, and **never** let its callback break the workflow.
   *
   * `onProgress` is arbitrary host code — a React `setState`, a CLI spinner, an
   * analytics call. A throw from it used to propagate out of `runAsync` as if
   * the *step* had failed, which is wrong twice over: the step succeeded, and
   * the throw lands between the step's work and whatever the caller does with
   * its result. On `acceptKontorOffer` that meant an already-broadcast swap
   * reveal surfacing as a raw callback error instead of
   * `KontorPurchaseNotRecordedError`, losing the txid the recovery needs; on the
   * pre-flight step it meant the Kontor session escaping its `try/finally`
   * unclosed. Progress reporting is telemetry, so it is contained here.
   */
  private emit(step: WorkflowStepFor<W>, phase: WorkflowProgressPhase): void {
    try {
      this.emitUnguarded(step, phase);
    } catch {
      // A broken progress listener is the host's problem, not the workflow's.
    }
  }

  private emitUnguarded(
    step: WorkflowStepFor<W>,
    phase: WorkflowProgressPhase,
  ): void {
    if (!this.onProgress) return;

    const messages = STEP_MESSAGES[this.workflow][step];
    const message =
      phase === "start"
        ? messages.start
        : phase === "complete"
          ? messages.complete
          : messages.error;

    this.onProgress({
      workflow: this.workflow,
      step,
      message,
      stepIndex: this.stepIndex,
      totalSteps: this.totalSteps,
      phase,
    } as WorkflowProgressEvent);
  }
}
