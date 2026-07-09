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

/**
 * Simulate React Native's engine: no `WebAssembly`, and a `navigator` whose
 * `product` is `"ReactNative"` (how RN advertises itself). This is the engine
 * where `@kontor/sdk` uses its native JSI backend (`@kontor/sdk-native`).
 */
function asReactNative(fn: () => void): void {
  // `globalThis.navigator` is an accessor with no setter (Node) — a plain
  // assignment throws under ESM strict mode — so swap it via a descriptor.
  const savedDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { product: "ReactNative" },
    configurable: true,
    writable: true,
  });
  try {
    withoutWebAssembly(fn);
  } finally {
    if (savedDesc) {
      Object.defineProperty(globalThis, "navigator", savedDesc);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
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

  it("reports available on React Native (native JSI backend, no WebAssembly)", () => {
    asReactNative(() => {
      expect(kontorRuntimeAvailable()).toBe(true);
      expect(() => assertKontorRuntime()).not.toThrow();
    });
  });

  it("reports unavailable with neither WebAssembly nor React Native", () => {
    withoutWebAssembly(() => {
      expect(kontorRuntimeAvailable()).toBe(false);
      expect(() => assertKontorRuntime()).toThrow(KontorUnavailableError);
    });
  });

  it("KontorUnavailableError carries a clear, named message", () => {
    const err = new KontorUnavailableError();
    expect(err.name).toBe("KontorUnavailableError");
    expect(err.message).toMatch(/@kontor\/sdk-native/);
  });
});
