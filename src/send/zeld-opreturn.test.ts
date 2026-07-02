import { describe, expect, it } from "vitest";
import {
  MAX_OP_RETURN_PAYLOAD_BYTES,
  buildZeldOpReturnScript,
  decodeZeldDistributionCbor,
  decodeZeldOpReturnScript,
  encodeZeldDistributionCbor,
} from "./zeld-opreturn.js";

describe("zeld distribution CBOR", () => {
  const cases: bigint[][] = [
    [],
    [0n],
    [1n],
    [23n], // max 1-byte inline
    [24n], // first u8
    [255n], // max u8
    [256n], // first u16
    [65535n], // max u16
    [65536n], // first u32
    [4294967295n], // max u32
    [4294967296n], // first u64
    [18446744073709551615n], // max u64
    [100000000n, 0n, 42n], // typical send: amount, btc-change=0, zeld-change
  ];

  it("round-trips every representative distribution", () => {
    for (const dist of cases) {
      const encoded = encodeZeldDistributionCbor(dist);
      expect(decodeZeldDistributionCbor(encoded)).toEqual(dist);
    }
  });

  it("round-trips through the full OP_RETURN script", () => {
    for (const dist of cases) {
      const script = buildZeldOpReturnScript(dist);
      expect(decodeZeldOpReturnScript(script)).toEqual(dist);
    }
  });

  it("uses minimal-width encoding (canonical CBOR)", () => {
    // [24] → array-header(0x81) + uint8 head(0x18) + value(0x18) = 3 bytes.
    expect([...encodeZeldDistributionCbor([24n])]).toEqual([0x81, 0x18, 0x18]);
    // [1] → array-header(0x81) + inline 1 (0x01) = 2 bytes.
    expect([...encodeZeldDistributionCbor([1n])]).toEqual([0x81, 0x01]);
  });

  it("rejects negative and out-of-range values", () => {
    expect(() => encodeZeldDistributionCbor([-1n])).toThrow();
    expect(() => encodeZeldDistributionCbor([0x10000000000000000n])).toThrow();
  });

  it("enforces the 80-byte OP_RETURN limit", () => {
    // Each u64 entry is up to 9 bytes; ~9 large values blow past 80 with the
    // 4-byte prefix + array header.
    const tooMany = Array.from({ length: 20 }, () => 18446744073709551615n);
    expect(() => buildZeldOpReturnScript(tooMany)).toThrow(/exceeds/);
  });

  it("returns null for non-ZELD scripts", () => {
    // A plain (non-OP_RETURN) 32-byte push is not a ZELD marker.
    expect(decodeZeldOpReturnScript(new Uint8Array([0x51, 0x20]))).toBeNull();
  });

  it("keeps a realistic payload within the standard limit", () => {
    const script = buildZeldOpReturnScript([100000000n, 0n, 0n]);
    // OP_RETURN(1) + push-len(1) + payload(<=80).
    expect(script.length).toBeLessThanOrEqual(2 + MAX_OP_RETURN_PAYLOAD_BYTES);
  });
});
