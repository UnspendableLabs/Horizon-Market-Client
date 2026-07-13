import { describe, expect, it } from "vitest";
import type { FeeEstimates } from "../hooks/useFeeEstimates.js";
import {
  FEE_LABELS,
  FEE_OPTIONS,
  rateForOption,
  type FeeOption,
} from "./feeRate.js";

const estimates: FeeEstimates = {
  fastestFee: 42,
  halfHourFee: 20,
  hourFee: 10,
  economyFee: 5,
  minimumFee: 1,
};

describe("FEE_OPTIONS", () => {
  it("lists the three presets in slow → normal → fast order", () => {
    expect(FEE_OPTIONS).toEqual(["slow", "normal", "fast"]);
  });
});

describe("FEE_LABELS", () => {
  it("maps each option to its display label", () => {
    expect(FEE_LABELS).toEqual({
      slow: "Slow",
      normal: "Normal",
      fast: "Fast",
    });
  });

  it("has a label for every option", () => {
    for (const option of FEE_OPTIONS) {
      expect(typeof FEE_LABELS[option]).toBe("string");
      expect(FEE_LABELS[option].length).toBeGreaterThan(0);
    }
  });
});

describe("rateForOption", () => {
  it("returns undefined for every option when estimates are null", () => {
    for (const option of FEE_OPTIONS) {
      expect(rateForOption(option, null)).toBeUndefined();
    }
  });

  it("maps fast → fastestFee", () => {
    expect(rateForOption("fast", estimates)).toBe(42);
  });

  it("maps slow → hourFee", () => {
    expect(rateForOption("slow", estimates)).toBe(10);
  });

  it("maps normal → halfHourFee (the default branch)", () => {
    expect(rateForOption("normal", estimates)).toBe(20);
  });

  it("resolves a rate for every preset", () => {
    for (const option of FEE_OPTIONS satisfies FeeOption[]) {
      expect(rateForOption(option, estimates)).toBeTypeOf("number");
    }
  });
});
