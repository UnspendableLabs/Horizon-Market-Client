import * as btc from "bitcoinjs-lib";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_REVEAL_VSIZE,
  KONTOR_COMMIT_VSIZE,
  estimateKontorMinerFee,
  revealVsizeFromBlob,
} from "./kontorFeeEstimate.js";

/** A minimal, well-formed (non-witness) tx we can measure the vsize of. */
function buildTxHex(): { hex: string; vsize: number } {
  const tx = new btc.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 1), 0);
  // A valid P2WPKH output script: OP_0 <20-byte hash>.
  tx.addOutput(Buffer.from(`0014${"ab".repeat(20)}`, "hex"), BigInt(1000));
  return { hex: tx.toHex(), vsize: tx.virtualSize() };
}

describe("constants", () => {
  it("exposes the calibrated commit vsize", () => {
    expect(KONTOR_COMMIT_VSIZE).toBe(154);
  });

  it("exposes fallback reveal vsizes per asset kind", () => {
    expect(FALLBACK_REVEAL_VSIZE.token).toBe(227);
    expect(FALLBACK_REVEAL_VSIZE.nft).toBe(216);
  });
});

describe("revealVsizeFromBlob", () => {
  it("returns the reveal tx vsize for a valid blob", () => {
    const { hex, vsize } = buildTxHex();
    const blob = JSON.stringify({ attachReveal: hex });
    expect(revealVsizeFromBlob(blob)).toBe(vsize);
    expect(revealVsizeFromBlob(blob)).toBeGreaterThan(0);
  });

  it("returns null when attachReveal is missing", () => {
    expect(revealVsizeFromBlob(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null when attachReveal is not a string", () => {
    expect(revealVsizeFromBlob(JSON.stringify({ attachReveal: 123 }))).toBeNull();
  });

  it("returns null when attachReveal is an empty string", () => {
    expect(revealVsizeFromBlob(JSON.stringify({ attachReveal: "" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(revealVsizeFromBlob("not json {")).toBeNull();
  });

  it("returns null when attachReveal is not valid tx hex", () => {
    expect(
      revealVsizeFromBlob(JSON.stringify({ attachReveal: "zzzz" })),
    ).toBeNull();
  });
});

describe("estimateKontorMinerFee", () => {
  it("multiplies (reveal + commit) vsize by the fee rate", () => {
    // (227 + 154) * 2 = 762
    expect(estimateKontorMinerFee(FALLBACK_REVEAL_VSIZE.token, 2)).toBe(762);
    // (216 + 154) * 3 = 1110
    expect(estimateKontorMinerFee(FALLBACK_REVEAL_VSIZE.nft, 3)).toBe(1110);
  });

  it("rounds the result up (ceil)", () => {
    // (100 + 154) * 1.1 = 279.4 -> 280
    expect(estimateKontorMinerFee(100, 1.1)).toBe(280);
  });

  it("handles a zero fee rate", () => {
    expect(estimateKontorMinerFee(227, 0)).toBe(0);
  });
});
