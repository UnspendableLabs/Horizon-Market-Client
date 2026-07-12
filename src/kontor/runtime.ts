/**
 * Runtime guard for `@kontor/sdk`.
 *
 * `@kontor/sdk` ships two interchangeable backends behind one identical API,
 * selected by the package's conditional exports:
 *   • Web / Node — a WebAssembly *component*, instantiated at import time
 *     (a top-level `await $init` that compiles the embedded module).
 *   • React Native — a native JSI module (`@kontor/sdk-native`, a uniffi wrapper
 *     over the same Rust core), because Hermes/JSC ship no `WebAssembly`. Its
 *     entry `import "@kontor/sdk-native"` installs a Rust crate into the runtime
 *     at import time.
 *
 * Either way, loading `@kontor/sdk` is **eager and heavy** at module-evaluation
 * time. So every Kontor code path in this client is reached through a dynamic
 * `import()` — the backend never evaluates at app startup — and is gated by the
 * helpers below. Non-Kontor features (BTC, Counterparty/XCP, ZELD, wallet,
 * sell/buy of non-Kontor assets) then work everywhere, and Kontor degrades
 * cleanly where its backend can't load (e.g. a React Native build that did not
 * link `@kontor/sdk-native`, or a plain browserless/WASM-less engine): reads
 * return empty holdings, writes throw {@link KontorUnavailableError} with a
 * clear message instead of surfacing a raw load error.
 *
 * This module intentionally has **no** `@kontor/sdk` import (static or dynamic),
 * so it is safe to load on any engine.
 */

/** Thrown when a Kontor operation is attempted where its backend can't load. */
export class KontorUnavailableError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(
      message ??
        "Kontor is unavailable in this environment: @kontor/sdk could not load a " +
          "backend. Kontor (KOR token + Kontor NFTs) needs either a WebAssembly " +
          "runtime (browsers, Node) or the native module @kontor/sdk-native linked " +
          "into the app build (React Native / Hermes).",
      options,
    );
    this.name = "KontorUnavailableError";
  }
}

/**
 * True when the host engine can load a `@kontor/sdk` backend: a WebAssembly
 * runtime (web/Node), or a React Native engine (its native JSI backend).
 *
 * On React Native this can't cheaply prove `@kontor/sdk-native` is actually
 * linked without loading it, so it optimistically reports available; a missing
 * native module then surfaces at the dynamic `import()` — reads degrade to empty
 * holdings, writes throw {@link KontorUnavailableError}.
 */
export function kontorRuntimeAvailable(): boolean {
  if (
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiate === "function"
  ) {
    return true;
  }
  return isReactNative();
}

/** Throw {@link KontorUnavailableError} when no Kontor backend can load. */
export function assertKontorRuntime(): void {
  if (!kontorRuntimeAvailable()) throw new KontorUnavailableError();
}

/**
 * React Native (Hermes/JSC) sets `navigator.product === "ReactNative"` — the
 * canonical, WASM-free way to detect the engine where `@kontor/sdk`'s native
 * JSI backend applies.
 */
function isReactNative(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as { product?: string }).product === "ReactNative"
  );
}
