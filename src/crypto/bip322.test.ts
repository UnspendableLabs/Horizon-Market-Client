import { describe, it, expect } from "vitest";
import { Verifier } from "bip322-js";
import { signBip322 } from "./bip322.js";
import { TEST_PRIVATE_KEY_HEX, TEST_P2WPKH_ADDRESS, TEST_P2TR_ADDRESS } from "../test-utils.js";

describe("signBip322", () => {
  it("signs a message and produces a verifiable BIP322 signature", () => {
    const message = "delist-request-id-abc123";
    const signature = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2WPKH_ADDRESS,
      message,
    );

    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);

    // Verify round-trip using bip322-js Verifier
    const isValid = Verifier.verifySignature(
      TEST_P2WPKH_ADDRESS,
      message,
      signature,
    );
    expect(isValid).toBe(true);
  });

  it("strips 0x prefix from private key hex", () => {
    const message = "test-message";
    const sigWithPrefix = signBip322(
      `0x${TEST_PRIVATE_KEY_HEX}`,
      TEST_P2WPKH_ADDRESS,
      message,
    );
    const sigWithout = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2WPKH_ADDRESS,
      message,
    );

    // Both should produce valid signatures (not necessarily identical — schnorr is randomized,
    // but ECDSA for P2WPKH is deterministic with RFC6979)
    expect(
      Verifier.verifySignature(TEST_P2WPKH_ADDRESS, message, sigWithPrefix),
    ).toBe(true);
    expect(
      Verifier.verifySignature(TEST_P2WPKH_ADDRESS, message, sigWithout),
    ).toBe(true);
  });

  it("produces different signatures for different messages", () => {
    const sig1 = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2WPKH_ADDRESS,
      "message-1",
    );
    const sig2 = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2WPKH_ADDRESS,
      "message-2",
    );

    expect(sig1).not.toBe(sig2);
    expect(Verifier.verifySignature(TEST_P2WPKH_ADDRESS, "message-1", sig1)).toBe(true);
    expect(Verifier.verifySignature(TEST_P2WPKH_ADDRESS, "message-2", sig2)).toBe(true);
  });

  it("fails verification for wrong address", () => {
    const message = "test";
    const signature = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2WPKH_ADDRESS,
      message,
    );

    // Verifying with a different address should fail
    const wrongAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const isValid = Verifier.verifySignature(wrongAddress, message, signature);
    expect(isValid).toBe(false);
  });

  it("signs and verifies with a P2TR address (ordinal delist path)", () => {
    const message = "delist-request-id-ordinal";
    const signature = signBip322(
      TEST_PRIVATE_KEY_HEX,
      TEST_P2TR_ADDRESS,
      message,
    );

    expect(
      Verifier.verifySignature(TEST_P2TR_ADDRESS, message, signature),
    ).toBe(true);
  });
});
