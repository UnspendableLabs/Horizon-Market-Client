// Test-only helpers for the React hook unit tests. Named `.tsx` so it is
// excluded from coverage (see vitest.config.ts) and never bundled by tsup
// (no production entry imports it). NOT part of the public API.
import { vi } from "vitest";
import type { HorizonMarketContextValue } from "./context.js";
import { defaultTheme } from "./theme.js";

export { renderHook, act, waitFor } from "@testing-library/react";

/**
 * Overrides accepted by {@link makeCtx}. Every field of the context is
 * optional; `client` is intentionally loosened to a plain record (or `null`
 * for an unauthenticated session) so a test can pass just the handful of
 * client methods the hook under test actually calls, without constructing a
 * full `HorizonMarketClient`.
 */
export type MakeCtxOverrides = Partial<
  Omit<HorizonMarketContextValue, "client">
> & {
  // Loosened to `object | null` so a test can pass either a full typed client,
  // a bare partial with only the methods the hook calls, or `null` for an
  // unauthenticated session — without wrestling the full `HorizonMarketClient`.
  client?: object | null;
};

/**
 * A fully-populated {@link HorizonMarketContextValue} for hooks under test.
 * Every hook reads `useHorizonMarket()`; mock that module and feed it one of
 * these. Override any field — including `client` (a loose mock, or `null`) and
 * `fetch` — via `overrides`. When `overrides.client` is provided it REPLACES
 * the default client mock (pass every method the hook needs); omit it to get a
 * default mock exposing `getAddresses`/`requestBuyQuote`/`requestSellQuote`.
 */
export function makeCtx(
  overrides: MakeCtxOverrides = {},
): HorizonMarketContextValue {
  const client = {
    getAddresses: vi.fn(),
    requestBuyQuote: vi.fn(),
    requestSellQuote: vi.fn(),
    ...(overrides.client as object | null | undefined),
  };
  return {
    client: client as unknown as HorizonMarketContextValue["client"],
    addresses: { p2wpkh: "bc1qwallet", p2tr: "bc1pwallet", publicKey: "02aa" },
    initialize: vi.fn(),
    initializeWithMnemonic: vi.fn(),
    logout: vi.fn(),
    derivationMode: "horizon-market",
    setDerivationMode: vi.fn(),
    mnemonicWordCount: 12,
    setMnemonicWordCount: vi.fn(),
    exportMnemonic: vi.fn(() => null),
    credits: 5,
    freeCredits: 3,
    isAuthenticated: true,
    refreshCredits: vi.fn(async () => {}),
    signInError: null,
    sessionSource: "key",
    network: "mainnet",
    kontorNetwork: undefined,
    baseUrl: "https://horizon.market",
    ordApiBaseUrl: undefined,
    balancesCacheTtlMs: undefined,
    fetch: vi.fn(),
    theme: defaultTheme,
    ...(overrides as Partial<HorizonMarketContextValue>),
  };
}

/**
 * A mutable holder the mocked `useHorizonMarket` reads from. Set `.current`
 * in `beforeEach`. Use with the hoisted mock pattern:
 *
 * ```ts
 * const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } }));
 * vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));
 * ```
 */
export type CtxRef = { current: HorizonMarketContextValue | null };
