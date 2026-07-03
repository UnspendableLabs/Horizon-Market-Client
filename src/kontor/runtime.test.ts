import { describe, it, expect, afterEach } from "vitest";
import {
  KontorUnavailableError,
  kontorRuntimeAvailable,
  assertKontorRuntime,
} from "./runtime.js";

/**
 * Simulate a JS engine without a WebAssembly runtime (React Native / Hermes) by
 * removing the global for the duration of a test, then restoring it.
 */
function withoutWebAssembly(fn: () => void): void {
  const saved = (globalThis as { WebAssembly?: unknown }).WebAssembly;
  delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
  try {
    fn();
  } finally {
    (globalThis as { WebAssembly?: unknown }).WebAssembly = saved;
  }
}

describe("kontor runtime guard", () => {
  afterEach(() => {
    // Guard against a test leaving WebAssembly removed if it throws unexpectedly.
    expect(typeof WebAssembly).toBe("object");
  });

  it("reports available when WebAssembly is present (Node/browser)", () => {
    expect(kontorRuntimeAvailable()).toBe(true);
    expect(() => assertKontorRuntime()).not.toThrow();
  });

  it("reports unavailable when WebAssembly is absent (Hermes-like)", () => {
    withoutWebAssembly(() => {
      expect(kontorRuntimeAvailable()).toBe(false);
      expect(() => assertKontorRuntime()).toThrow(KontorUnavailableError);
    });
  });

  it("KontorUnavailableError carries a clear, named message", () => {
    const err = new KontorUnavailableError();
    expect(err.name).toBe("KontorUnavailableError");
    expect(err.message).toMatch(/WebAssembly/);
  });
});
