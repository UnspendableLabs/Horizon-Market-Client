import { describe, it, expect } from "vitest";
import { creationCostLines, xcpFeeNotice } from "./creationCost.js";
import type { CreationQuote } from "../../api/creations.js";

const COUNTERPARTY: CreationQuote = {
  type: "counterparty",
  identifier: "MYASSET",
  psbtBase64: "cHNidP8BAA==",
  inputsToSign: [0],
  revealTxHex: null,
  estimatedFeeSats: 1240,
  totalCostSats: 1240,
};

const ORDINAL: CreationQuote = {
  ...COUNTERPARTY,
  type: "ordinals",
  identifier: "abc123i0",
  revealTxHex: "0200reveal",
  totalCostSats: 1786, // fees + 546 postage
};

describe("creationCostLines", () => {
  it("shows one fee row and the total when the two are the same", () => {
    const lines = creationCostLines(COUNTERPARTY, null);

    expect(lines.map((l) => l.key)).toEqual(["network", "total"]);
    expect(lines[0]?.usd).toBeNull();
    expect(lines[1]).toMatchObject({ sats: 1240, emphasis: true });
  });

  it("breaks the inscription postage out — it is not a fee", () => {
    const lines = creationCostLines(ORDINAL, 100_000);

    expect(lines.map((l) => l.key)).toEqual(["network", "postage", "total"]);
    expect(lines[1]).toMatchObject({ sats: 546 });
    expect(lines[1]?.hint).toMatch(/stays with the inscription/);
    // The rows add up to the total the user is asked to approve.
    expect((lines[0]?.sats ?? 0) + (lines[1]?.sats ?? 0)).toBe(lines[2]?.sats);
  });

  it("formats USD once a price is known", () => {
    const lines = creationCostLines(COUNTERPARTY, 100_000);
    expect(lines[0]?.usd).toBe("$1.24");
  });
});

describe("xcpFeeNotice", () => {
  it("prices a named asset and a subasset", () => {
    expect(xcpFeeNotice("counterparty", "MYASSET")).toMatchObject({
      requiredXcp: 0.5,
    });
    expect(xcpFeeNotice("counterparty", "PEPENARDO.card")).toMatchObject({
      requiredXcp: 0.25,
    });
  });

  it("says nothing for a free numeric name or a non-Counterparty creation", () => {
    expect(xcpFeeNotice("counterparty", "A95428956661682177")).toBeNull();
    expect(xcpFeeNotice("ordinals", "My inscription")).toBeNull();
  });

  it("says nothing before a name has been typed", () => {
    // A fee is a fact about a name. Quoting one for the empty string puts a
    // 0.5 XCP warning — and a red insufficient-balance line — on a form the
    // user has not touched.
    expect(xcpFeeNotice("counterparty", "")).toBeNull();
  });
});
