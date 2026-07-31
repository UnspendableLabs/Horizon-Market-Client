import { describe, it, expect } from "vitest";
import {
  detachGasLimitFromBlob,
  korCostForGas,
  maxListableKor,
  subtractKor,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_ATTACH_GAS_LIMIT,
  KONTOR_DETACH_GAS_LIMIT,
} from "./gas.js";

/**
 * Gas pricing is string/BigInt math on purpose: KOR amounts are
 * arbitrary-precision decimals on the wire, and these values decide whether a
 * listing is allowed to broadcast. A float round-trip anywhere here would move
 * the last digits of a balance and either block a good listing or wave through
 * one that cannot pay its own gas.
 */

describe("korCostForGas", () => {
  it("prices the three gas limits the client commits to", () => {
    expect(korCostForGas(KONTOR_ATTACH_GAS_LIMIT)).toBe("0.0001");
    expect(korCostForGas(KONTOR_ACCEPT_GAS_LIMIT)).toBe("0.00005");
    expect(korCostForGas(KONTOR_DETACH_GAS_LIMIT)).toBe("0.0001");
  });

  it("handles whole-KOR, fractional and degenerate gas limits", () => {
    expect(korCostForGas(1_000_000_000)).toBe("1");
    expect(korCostForGas(2_500_000_000)).toBe("2.5");
    expect(korCostForGas(1)).toBe("0.000000001");
    expect(korCostForGas(0)).toBe("0");
    expect(korCostForGas(-5)).toBe("0");
    expect(korCostForGas(1.9)).toBe("0.000000001");
  });
});

describe("subtractKor", () => {
  it("subtracts across differing scales without touching a float", () => {
    expect(subtractKor("10", "0.0001")).toBe("9.9999");
    expect(subtractKor("0.3", "0.1")).toBe("0.2");
    expect(subtractKor("100", "3")).toBe("97");
    expect(subtractKor(".5", "0.25")).toBe("0.25");
  });

  it("keeps precision a float would lose", () => {
    // 9007199254740993 is the first integer Number cannot represent.
    expect(subtractKor("9007199254740993", "1")).toBe("9007199254740992");
    expect(subtractKor("1.000000000000000002", "0.000000000000000001")).toBe(
      "1.000000000000000001",
    );
  });

  it("clamps at zero instead of reporting a negative remainder", () => {
    expect(subtractKor("0.0001", "0.0001")).toBe("0");
    expect(subtractKor("0.00005", "0.0001")).toBe("0");
  });

  it("returns null for anything it cannot parse", () => {
    expect(subtractKor("", "1")).toBeNull();
    expect(subtractKor("abc", "1")).toBeNull();
    expect(subtractKor("1e-9", "1")).toBeNull();
    expect(subtractKor("1", "-1")).toBeNull();
  });
});

describe("maxListableKor", () => {
  it("stops short of the gas the listing's own attach holds", () => {
    // Offering the raw balance would make "Max" a guaranteed pre-flight refusal:
    // the gas hold lands before the attach moves the tokens.
    expect(maxListableKor("10")).toBe("9.9999");
    expect(maxListableKor("0.0002")).toBe("0.0001");
  });

  it("is null when the balance cannot even cover the gas", () => {
    expect(maxListableKor("0.0001")).toBeNull();
    expect(maxListableKor("0.00001")).toBeNull();
    expect(maxListableKor("0")).toBeNull();
  });

  it("is null for an unreadable balance rather than guessing", () => {
    expect(maxListableKor("")).toBeNull();
    expect(maxListableKor("n/a")).toBeNull();
  });
});

describe("detachGasLimitFromBlob", () => {
  it("reads the limit the offer blob's detach actually committed to", () => {
    const blob = JSON.stringify({
      v: 1,
      detachInsts: {
        ops: [{ gas_limit: 250_000, kind: "Call" }],
        aggregate: null,
      },
    });
    expect(detachGasLimitFromBlob(blob)).toBe(250_000);
  });

  it("takes the largest limit when an input carries several ops", () => {
    // Ops of one input are held and settled in turn, so the requirement is the
    // largest single hold, not their sum.
    const blob = JSON.stringify({
      detachInsts: { ops: [{ gas_limit: 40_000 }, { gas_limit: 90_000 }] },
    });
    expect(detachGasLimitFromBlob(blob)).toBe(90_000);
  });

  it("falls back to the SDK default rather than throwing on an unreadable blob", () => {
    // Failing to *read* the limit must not be what blocks a delist.
    expect(detachGasLimitFromBlob("not json")).toBe(KONTOR_DETACH_GAS_LIMIT);
    expect(detachGasLimitFromBlob("null")).toBe(KONTOR_DETACH_GAS_LIMIT);
    expect(detachGasLimitFromBlob("{}")).toBe(KONTOR_DETACH_GAS_LIMIT);
    expect(detachGasLimitFromBlob('{"detachInsts":null}')).toBe(
      KONTOR_DETACH_GAS_LIMIT,
    );
    expect(detachGasLimitFromBlob('{"detachInsts":{"ops":[]}}')).toBe(
      KONTOR_DETACH_GAS_LIMIT,
    );
    expect(detachGasLimitFromBlob('{"detachInsts":{"ops":[null]}}')).toBe(
      KONTOR_DETACH_GAS_LIMIT,
    );
    expect(
      detachGasLimitFromBlob('{"detachInsts":{"ops":[{"gas_limit":"x"}]}}'),
    ).toBe(KONTOR_DETACH_GAS_LIMIT);
  });
});
