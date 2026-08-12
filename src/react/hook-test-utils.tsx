// Test-only helpers for the React hook unit tests. Named `.tsx` so it is
// excluded from coverage (see vitest.config.ts) and never bundled by tsup
// (no production entry imports it). NOT part of the public API.
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { DEFAULT_ZELD_API_BASE_URL } from "../config.js";
import type { HorizonMarketContextValue } from "./context.js";
import { defaultTheme } from "./theme.js";

export { renderHook, act, waitFor } from "@testing-library/react";

/**
 * Unmount every hook a test rendered, before the next one runs.
 *
 * Testing Library registers this itself — but only when `afterEach` is a
 * global, and this project runs Vitest with `globals: false` (every test file
 * imports its own). So auto-cleanup silently never armed, and each file's hooks
 * accumulated: mounted, un-awaited and still reading the module-level `ctxRef`
 * that the NEXT test overwrites through `makeCtx`.
 *
 * That is not merely untidy, it is a race. A test that stops at "the request
 * went out" leaves its promise in flight; the resolution lands during a later
 * test, sets state on the leaked hook, and re-renders it against a context
 * whose `client` and inputs both changed — so its effect re-runs and calls the
 * *later* test's mock. The symptom is a call count one too high, on the slower
 * of two machines, in a test that never mentions the hook responsible.
 *
 * Registered here rather than in each file because every hook test already
 * imports this module, and a cleanup that has to be remembered is one that
 * eventually isn't.
 */
afterEach(cleanup);

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
    initializeWithSigner: vi.fn(),
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
    // The provider hands hooks the RESOLVED value (mainnet default applied), so
    // ZELD is visible under the default ctx; Kontor is not (kontorNetwork
    // unset). Tests that exercise the Kontor-visible surfaces override it.
    zeldApiBaseUrl: DEFAULT_ZELD_API_BASE_URL,
    balancesCacheTtlMs: undefined,
    balancesRefreshKey: 0,
    refreshBalances: vi.fn(),
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
