import { describe, it, expect } from "vitest";
import { base64, hex } from "@scure/base";
import { psbtBase64ToHex, serializeAssetQuantity } from "./utils.js";
import { FIXTURE_PSBT_HEX } from "./test-utils.js";

describe("serializeAssetQuantity", () => {
  it("keeps numbers and small bigints as numbers, large ones as strings", () => {
    expect(serializeAssetQuantity(42)).toBe(42);
    expect(serializeAssetQuantity(42n)).toBe(42);
    expect(serializeAssetQuantity(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe(
      "9007199254740992",
    );
  });

  it("passes null and undefined through", () => {
    expect(serializeAssetQuantity(null)).toBeNull();
    expect(serializeAssetQuantity(undefined)).toBeUndefined();
  });
});

describe("psbtBase64ToHex", () => {
  const asBase64 = base64.encode(hex.decode(FIXTURE_PSBT_HEX));

  it("round-trips a real PSBT byte for byte", () => {
    expect(psbtBase64ToHex(asBase64)).toBe(FIXTURE_PSBT_HEX);
  });

  it("tolerates surrounding whitespace", () => {
    expect(psbtBase64ToHex(`  ${asBase64}\n`)).toBe(FIXTURE_PSBT_HEX);
  });

  it("rejects input that is not base64", () => {
    expect(() => psbtBase64ToHex("not base64 !!")).toThrow(/valid base64/);
  });

  it("rejects valid base64 that is not a PSBT", () => {
    // Deliberately all-hex-looking characters: there is no "already hex, pass
    // it through" shortcut, so this must be caught by the magic bytes instead.
    expect(() => psbtBase64ToHex(base64.encode(new Uint8Array([1, 2, 3])))).toThrow(
      /magic bytes/,
    );
  });
});
