import { describe, expect, it } from "vitest";
import type {
  OpenSellOrderStep,
  WorkflowProgressEvent,
} from "../../types/progress.js";
import { reduceSteps } from "./progress.js";

function event(
  step: OpenSellOrderStep,
  phase: WorkflowProgressEvent["phase"],
  message?: string,
): WorkflowProgressEvent {
  return {
    workflow: "openSellOrder",
    step,
    message: message ?? step,
    stepIndex: 1,
    totalSteps: 3,
    phase,
  };
}

describe("reduceSteps", () => {
  it("maps start events to running state", () => {
    const view = reduceSteps([event("validateParams", "start")]);
    expect(view).toEqual([
      { key: "validateParams", label: "validateParams", state: "running" },
    ]);
  });

  it("keeps one row per step with the latest phase", () => {
    const view = reduceSteps([
      event("validateParams", "start", "Validating…"),
      event("validateParams", "complete", "Validated"),
      event("requestSellQuote", "start", "Quoting…"),
    ]);
    expect(view).toEqual([
      { key: "validateParams", label: "Validated", state: "complete" },
      { key: "requestSellQuote", label: "Quoting…", state: "running" },
    ]);
  });

  it("maps error phase to error state", () => {
    const view = reduceSteps([
      event("signSwapPsbt", "start"),
      event("signSwapPsbt", "error", "Signing failed"),
    ]);
    expect(view.at(-1)?.state).toBe("error");
  });

  it("preserves chronological step order", () => {
    const view = reduceSteps([
      event("createSwap", "start"),
      event("signSwapPsbt", "start"),
      event("signSwapPsbt", "complete"),
    ]);
    expect(view.map((s) => s.key)).toEqual(["createSwap", "signSwapPsbt"]);
  });
});
