import { describe, expect, it } from "vitest";
import { stepVisual } from "./progress.js";

// Covers `stepVisual` (lines 30-44) — the existing suite only exercises
// `reduceSteps`. Each reduced step state maps to one icon + semantic color pair.
describe("stepVisual", () => {
  it("maps a complete step to a check glyph with success color", () => {
    expect(stepVisual("complete")).toEqual({
      icon: "✓",
      iconColorKey: "success",
      labelColorKey: "text",
    });
  });

  it("maps a running step to a null icon (platform spinner) with pending color", () => {
    expect(stepVisual("running")).toEqual({
      icon: null,
      iconColorKey: "pending",
      labelColorKey: "text",
    });
  });

  it("maps an error step to a cross glyph with error color", () => {
    expect(stepVisual("error")).toEqual({
      icon: "✗",
      iconColorKey: "error",
      labelColorKey: "text",
    });
  });

  it("maps a pending step to a hollow circle with muted colors", () => {
    expect(stepVisual("pending")).toEqual({
      icon: "○",
      iconColorKey: "textMuted",
      labelColorKey: "textMuted",
    });
  });
});
