import type { WorkflowProgressEvent } from "../../types/index.js";

export interface StepView {
  key: string;
  label: string;
  state: "complete" | "running" | "error" | "pending";
}

/**
 * Reduce raw progress events to the latest state per step, in chronological
 * order. Each step appears once with its final phase.
 */
export function reduceSteps(events: WorkflowProgressEvent[]): StepView[] {
  const order: string[] = [];
  const map = new Map<string, StepView>();
  for (const e of events) {
    const key = String(e.step);
    if (!map.has(key)) order.push(key);
    const state: StepView["state"] =
      e.phase === "complete"
        ? "complete"
        : e.phase === "error"
          ? "error"
          : "running";
    map.set(key, { key, label: e.message, state });
  }
  return order.map((k) => map.get(k)!);
}
