// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import {
  useKontorPreflight,
  kontorPreflightNotice,
  type KontorPreflightTarget,
  type UseKontorPreflightResult,
} from "./useKontorPreflight.js";
import type { AtomicSwap } from "../../types/index.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

/**
 * The review screens' half of the Kontor gate: ask the chain whether a flow
 * would execute, *before* offering the button that commits to it. The contract
 * that matters is which answers block — a refusal does, a failure to check does
 * not — because getting that backwards either lets a doomed transaction through
 * or strands a funded user behind a flaky indexer.
 */

const SWAP = { id: "swap-1", listingType: "kontor" } as unknown as AtomicSwap;

function verdict(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    error: null,
    balanceKor: "1.5",
    requiredKor: "0.0001",
    gasLimit: 100_000,
    signerId: 16,
    ...over,
  };
}

function setCtx(client: object | null, over: Record<string, unknown> = {}) {
  ctxRef.current = makeCtx({
    client,
    network: "testnet",
    kontorNetwork: "signet",
    ...over,
  });
}

const LISTING: KontorPreflightTarget = {
  flow: "listing",
  params: { kontorAssetKind: "token", korAmount: "10" },
};

afterEach(() => {
  vi.restoreAllMocks();
  ctxRef.current = null;
});

beforeEach(() => {
  ctxRef.current = null;
});

describe("useKontorPreflight", () => {
  it("reports a clean verdict with the numbers a review screen shows", async () => {
    const preflightKontorListing = vi.fn(async () => verdict());
    setCtx({ preflightKontorListing });

    const { result } = renderHook(() => useKontorPreflight(LISTING));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(preflightKontorListing).toHaveBeenCalledWith(LISTING.params);
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.blockedReason).toBeNull();
    expect(result.current.requiredKor).toBe("0.0001");
    expect(result.current.balanceKor).toBe("1.5");
  });

  it("blocks on a refusal, carrying the words that say how to fix it", async () => {
    const error = new Error("Not enough KOR to pay Kontor network gas. …");
    setCtx({
      preflightKontorListing: vi.fn(async () =>
        verdict({ ok: false, error, balanceKor: "0" }),
      ),
    });

    const { result } = renderHook(() => useKontorPreflight(LISTING));

    await waitFor(() => expect(result.current.canSubmit).toBe(false));
    expect(result.current.blockedReason).toBe(error.message);
    expect(result.current.checkError).toBeNull();
    // The gas figures are still filled in — the screen can show the shortfall.
    expect(result.current.requiredKor).toBe("0.0001");
  });

  it("does NOT block when the check itself couldn't be made", async () => {
    // An unreachable indexer is not a verdict. Blocking here would strand a
    // funded user behind a transient outage — and buy nothing, since the
    // workflow re-runs the same check before it broadcasts anything.
    setCtx({
      preflightKontorListing: vi.fn(() =>
        Promise.reject(new Error("Kontor signer lookup failed (HTTP 503)")),
      ),
    });

    const { result } = renderHook(() => useKontorPreflight(LISTING));

    await waitFor(() => expect(result.current.checkError).not.toBeNull());
    expect(result.current.canSubmit).toBe(true);
    expect(result.current.blockedReason).toBeNull();
  });

  it("asks the right client method per flow, passing the swap it already has", async () => {
    const preflightKontorPurchase = vi.fn(async () => verdict());
    const preflightKontorDelist = vi.fn(async () => verdict());
    setCtx({ preflightKontorPurchase, preflightKontorDelist });

    const purchase = renderHook(() =>
      useKontorPreflight({ flow: "purchase", swap: SWAP }),
    );
    await waitFor(() => expect(purchase.result.current.loading).toBe(false));
    // The whole swap, not its id: no needless round-trip to re-fetch it.
    expect(preflightKontorPurchase).toHaveBeenCalledWith(SWAP);

    const delist = renderHook(() =>
      useKontorPreflight({ flow: "delist", swap: SWAP }),
    );
    await waitFor(() => expect(delist.result.current.loading).toBe(false));
    expect(preflightKontorDelist).toHaveBeenCalledWith(SWAP);
  });

  it("stays idle — and free — when there is nothing to ask about", async () => {
    const preflightKontorListing = vi.fn(async () => verdict());

    // No target.
    setCtx({ preflightKontorListing });
    const idle = renderHook(() => useKontorPreflight(null));
    expect(idle.result.current.canSubmit).toBe(true);

    // Kontor not configured on this client.
    setCtx({ preflightKontorListing }, { kontorNetwork: undefined });
    renderHook(() => useKontorPreflight(LISTING));

    // No wallet connected: the call would throw "requires authentication".
    setCtx({ preflightKontorListing }, { addresses: null });
    renderHook(() => useKontorPreflight(LISTING));

    await act(async () => {});
    expect(preflightKontorListing).not.toHaveBeenCalled();
  });

  it("re-asks when the subject changes, but not when an equal target is rebuilt", async () => {
    const preflightKontorListing = vi.fn(async () => verdict());
    setCtx({ preflightKontorListing });

    const { result, rerender } = renderHook(
      ({ amount }: { amount: string }) =>
        useKontorPreflight({
          flow: "listing",
          params: { kontorAssetKind: "token", korAmount: amount },
        }),
      { initialProps: { amount: "10" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(preflightKontorListing).toHaveBeenCalledTimes(1);

    // A fresh-but-equal params object each render must not re-hit the indexer.
    rerender({ amount: "10" });
    await act(async () => {});
    expect(preflightKontorListing).toHaveBeenCalledTimes(1);

    // A different amount is a different question.
    rerender({ amount: "20" });
    await waitFor(() => expect(preflightKontorListing).toHaveBeenCalledTimes(2));
  });

  it("re-asks when the connected wallet changes", async () => {
    // The answer is about a wallet, so switching wallets invalidates it —
    // otherwise a funded account's verdict would license an empty one's listing.
    const preflightKontorListing = vi.fn(async () => verdict());
    setCtx({ preflightKontorListing });
    const { result, rerender } = renderHook(() => useKontorPreflight(LISTING));
    await waitFor(() => expect(result.current.loading).toBe(false));

    setCtx(
      { preflightKontorListing },
      { addresses: { p2wpkh: "bc1qother", p2tr: "bc1pother", publicKey: "02bb" } },
    );
    rerender();
    await waitFor(() => expect(preflightKontorListing).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale answer that lands after a newer question", async () => {
    // Without the guard, a slow refusal for the previous amount would disable
    // the button for an amount the wallet can actually afford.
    let resolveFirst: ((v: unknown) => void) | null = null;
    const preflightKontorListing = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(async () => verdict());
    setCtx({ preflightKontorListing });

    const { result, rerender } = renderHook(
      ({ amount }: { amount: string }) =>
        useKontorPreflight({
          flow: "listing",
          params: { kontorAssetKind: "token", korAmount: amount },
        }),
      { initialProps: { amount: "10" } },
    );

    rerender({ amount: "1" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canSubmit).toBe(true);

    await act(async () => {
      resolveFirst?.(verdict({ ok: false, error: new Error("too much KOR") }));
    });
    expect(result.current.blockedReason).toBeNull();
    expect(result.current.canSubmit).toBe(true);
  });

  it("recheck asks again — for the user who just funded their account", async () => {
    const preflightKontorListing = vi
      .fn()
      .mockResolvedValueOnce(
        verdict({ ok: false, error: new Error("Not enough KOR"), balanceKor: "0" }),
      )
      .mockResolvedValueOnce(verdict());
    setCtx({ preflightKontorListing });

    const { result } = renderHook(() => useKontorPreflight(LISTING));
    await waitFor(() => expect(result.current.canSubmit).toBe(false));

    act(() => result.current.recheck());
    await waitFor(() => expect(result.current.canSubmit).toBe(true));
    expect(preflightKontorListing).toHaveBeenCalledTimes(2);
  });
});

describe("kontorPreflightNotice", () => {
  const base: UseKontorPreflightResult = {
    loading: false,
    blockedReason: null,
    checkError: null,
    requiredKor: null,
    balanceKor: null,
    canSubmit: true,
    recheck: () => {},
  };

  it("says nothing while nothing is wrong, or while still asking", () => {
    expect(kontorPreflightNotice(base)).toBeNull();
    expect(kontorPreflightNotice({ ...base, loading: true })).toBeNull();
  });

  it("passes a refusal through verbatim, as a blocker", () => {
    // The SDK's message already names the amounts and the fix; re-wording it
    // here would only lose that.
    const notice = kontorPreflightNotice({
      ...base,
      canSubmit: false,
      blockedReason: "Not enough KOR to pay Kontor network gas. …",
    });
    expect(notice).toEqual({
      tone: "blocked",
      text: "Not enough KOR to pay Kontor network gas. …",
    });
  });

  it("frames a failed check as a warning that does not stop the user", () => {
    const notice = kontorPreflightNotice({
      ...base,
      checkError: new Error("Kontor signer lookup failed (HTTP 503)."),
    });
    expect(notice?.tone).toBe("warning");
    expect(notice?.text).toContain("HTTP 503");
    expect(notice?.text).toContain("You can still continue");
  });

  it("prefers the refusal when a later check also failed", () => {
    // Both set is a contradiction the reducer resolves in favour of the answer
    // that was actually obtained.
    const notice = kontorPreflightNotice({
      ...base,
      canSubmit: false,
      blockedReason: "Not enough KOR",
      checkError: new Error("indexer down"),
    });
    expect(notice?.tone).toBe("blocked");
  });
});
