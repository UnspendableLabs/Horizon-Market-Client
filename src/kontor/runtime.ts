/**
 * Runtime guard for the WebAssembly-backed `@kontor/sdk`.
 *
 * `@kontor/sdk` is a WASM *component*: it instantiates its embedded module at
 * **import time** (a top-level `await $init` that compiles/instantiates the
 * `.core.wasm`) and relies on the JSPI stack-switching proposal
 * (`WebAssembly.promising`). It therefore only loads on engines that ship a
 * capable `WebAssembly` — browsers and Node. It **cannot** run on React Native's
 * Hermes/JSC engines, which expose no `WebAssembly` global at all (merely
 * *importing* the module throws `ReferenceError: WebAssembly is not defined`).
 *
 * To keep the client usable on such engines, every Kontor code path is reached
 * through a dynamic `import()` — so the WASM module never evaluates at app
 * startup — and is gated by the helpers below. Non-Kontor features (BTC,
 * Counterparty/XCP, ZELD, wallet, sell/buy of non-Kontor assets) then work
 * everywhere; only KOR/Kontor-NFT reads and writes degrade: reads return empty
 * holdings, writes throw {@link KontorUnavailableError} with a clear message
 * instead of crashing the host app with a raw `ReferenceError`.
 *
 * This module intentionally has **no** static `@kontor/sdk` import, so it is
 * safe to load on any engine.
 */

/** Thrown when a Kontor operation is attempted on an engine without a WASM runtime. */
export class KontorUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Kontor is unavailable on this device: @kontor/sdk requires a WebAssembly " +
          "runtime, which this JavaScript engine (e.g. React Native / Hermes) does " +
          "not provide. Kontor (KOR token + Kontor NFTs) is only supported where " +
          "WebAssembly is available (browsers, Node).",
    );
    this.name = "KontorUnavailableError";
  }
}

/** True when the host engine can load the `@kontor/sdk` WASM runtime. */
export function kontorRuntimeAvailable(): boolean {
  return (
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiate === "function"
  );
}

/** Throw {@link KontorUnavailableError} when the WASM runtime is absent. */
export function assertKontorRuntime(): void {
  if (!kontorRuntimeAvailable()) throw new KontorUnavailableError();
}
