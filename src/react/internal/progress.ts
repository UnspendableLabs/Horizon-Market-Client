import type { WorkflowProgressEvent } from "../../types/index.js";

export interface StepView {
  key: string;
  label: string;
  state: "complete" | "running" | "error" | "pending";
}

/** Semantic color role for a step's icon (maps to a theme/token color). */
export type StepColorKey = "success" | "pending" | "error" | "textMuted";
/** Semantic color role for a step's label text. */
export type StepLabelColorKey = "text" | "textMuted";

export interface StepVisual {
  /** Glyph to show; `null` means render the platform's running spinner instead. */
  icon: "✓" | "✗" | "○" | null;
  /** Icon color as a semantic theme role. */
  iconColorKey: StepColorKey;
  /** Label color as a semantic theme role. */
  labelColorKey: StepLabelColorKey;
}

/**
 * Map a reduced step state to its icon + semantic color roles, so the web and
 * native renderers derive identical visuals from one source — each only
 * translates the returned color keys to its platform's token/theme value. Keeps
 * the icon/color choices from drifting between the two `Step` components.
 */
export function stepVisual(state: StepView["state"]): StepVisual {
  switch (state) {
    case "complete":
      return { icon: "✓", iconColorKey: "success", labelColorKey: "text" };
    case "running":
      return { icon: null, iconColorKey: "pending", labelColorKey: "text" };
    case "error":
      return { icon: "✗", iconColorKey: "error", labelColorKey: "text" };
    case "pending":
      return {
        icon: "○",
        iconColorKey: "textMuted",
        labelColorKey: "textMuted",
      };
  }
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
