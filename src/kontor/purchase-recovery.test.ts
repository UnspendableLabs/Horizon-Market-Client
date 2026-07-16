import { describe, expect, it } from "vitest";
import { kontorPurchaseRecovery } from "./purchase-recovery.js";

/** Build a duck-typed KontorPurchaseNotRecordedError shape. */
function notRecorded(
  fields: Partial<{ swapId: unknown; txId: unknown; buyerAddress: unknown }>,
): Error {
  const e = new Error("not recorded");
  e.name = "KontorPurchaseNotRecordedError";
  Object.assign(e, fields);
  return e;
}

describe("kontorPurchaseRecovery", () => {
  it("extracts the carried recovery fields from a KontorPurchaseNotRecordedError", () => {
    const e = notRecorded({
      swapId: "swap-1",
      txId: "tx-reveal",
      buyerAddress: "bc1qbuyer",
    });
    expect(kontorPurchaseRecovery(e)).toEqual({
      swapId: "swap-1",
      txId: "tx-reveal",
      buyerAddress: "bc1qbuyer",
    });
  });

  it("returns null for an unrelated error", () => {
    expect(kontorPurchaseRecovery(new Error("HTTP 400: nope"))).toBeNull();
  });

  it("returns null for non-Error values", () => {
    expect(kontorPurchaseRecovery("KontorPurchaseNotRecordedError")).toBeNull();
    expect(kontorPurchaseRecovery(null)).toBeNull();
    expect(kontorPurchaseRecovery(undefined)).toBeNull();
  });

  it("returns null when the name matches but a field is missing or mistyped", () => {
    expect(
      kontorPurchaseRecovery(notRecorded({ swapId: "s", txId: "t" })),
    ).toBeNull();
    expect(
      kontorPurchaseRecovery(
        notRecorded({ swapId: "s", txId: 42, buyerAddress: "b" }),
      ),
    ).toBeNull();
  });
});
