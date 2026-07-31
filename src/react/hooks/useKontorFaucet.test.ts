// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useKontorFaucet } from "./useKontorFaucet.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

/** A signet context with a taproot key — the only shape where the faucet exists. */
function signetCtx(client: object) {
  return makeCtx({
    network: "testnet",
    kontorNetwork: "signet",
    addresses: {
      p2wpkh: "tb1qwallet",
      p2tr: "tb1pwallet",
      publicKey: "02aa",
      xOnlyPubkey: "ab".repeat(32),
    },
    client,
  });
}

describe("useKontorFaucet", () => {
  beforeEach(() => {
    ctxRef.current = signetCtx({ requestKontorFaucet: vi.fn() });
  });

  it("is unavailable off signet — mainnet has no faucet to offer", () => {
    ctxRef.current = makeCtx({ network: "mainnet", kontorNetwork: undefined });
    const { result } = renderHook(() => useKontorFaucet());
    expect(result.current.available).toBe(false);
  });

  it("is unavailable when the wallet exposes no taproot key to credit", () => {
    ctxRef.current = makeCtx({
      network: "testnet",
      kontorNetwork: "signet",
      addresses: { p2wpkh: "tb1qwallet", publicKey: "02aa" },
    });
    const { result } = renderHook(() => useKontorFaucet());
    expect(result.current.available).toBe(false);
  });

  it("reports the grant and the txids once the faucet accepts", async () => {
    const requestKontorFaucet = vi
      .fn()
      .mockResolvedValue({ commitTxid: "aa11", revealTxid: "bb22" });
    ctxRef.current = signetCtx({ requestKontorFaucet });

    const { result } = renderHook(() => useKontorFaucet());
    expect(result.current.available).toBe(true);
    expect(result.current.amountKor).toBe(10);
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.request();
    });

    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({
      commitTxid: "aa11",
      revealTxid: "bb22",
    });
    expect(result.current.error).toBeNull();
  });

  it("lands a refusal in `error` instead of rejecting the click handler", async () => {
    const requestKontorFaucet = vi
      .fn()
      .mockRejectedValue(new Error("FAUCET_UNAVAILABLE"));
    ctxRef.current = signetCtx({ requestKontorFaucet });

    const { result } = renderHook(() => useKontorFaucet());
    await act(async () => {
      // Must not throw: the button's onPress does not try/catch.
      await result.current.request();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("FAUCET_UNAVAILABLE");
    expect(result.current.result).toBeNull();
  });

  it("ignores a second request while one is in flight — one grant per click", async () => {
    let release: (v: {
      commitTxid: string;
      revealTxid: string;
    }) => void = () => {};
    const requestKontorFaucet = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    ctxRef.current = signetCtx({ requestKontorFaucet });

    const { result } = renderHook(() => useKontorFaucet());
    act(() => {
      void result.current.request();
      void result.current.request();
    });
    await waitFor(() => expect(result.current.status).toBe("requesting"));
    expect(requestKontorFaucet).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ commitTxid: "aa11", revealTxid: "bb22" });
    });
    expect(result.current.status).toBe("success");
  });

  it("reset() clears the outcome and drops the in-flight response", async () => {
    let release: (v: {
      commitTxid: string;
      revealTxid: string;
    }) => void = () => {};
    const requestKontorFaucet = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    ctxRef.current = signetCtx({ requestKontorFaucet });

    const { result } = renderHook(() => useKontorFaucet());
    act(() => {
      void result.current.request();
    });
    await waitFor(() => expect(result.current.status).toBe("requesting"));

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");

    // The abandoned request resolving must not repaint a dialog the user closed.
    await act(async () => {
      release({ commitTxid: "aa11", revealTxid: "bb22" });
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
  });

  // The abandoned request can stay in flight for as long as the faucet takes to
  // answer; if reset() left the in-flight guard up, the user who reopened the
  // dialog would press a button that does nothing at all, with no error to show.
  it("lets a request start again right after reset(), without waiting on the abandoned one", async () => {
    let release: (v: {
      commitTxid: string;
      revealTxid: string;
    }) => void = () => {};
    const requestKontorFaucet = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue({ commitTxid: "cc33", revealTxid: "dd44" });
    ctxRef.current = signetCtx({ requestKontorFaucet });

    const { result } = renderHook(() => useKontorFaucet());
    act(() => {
      void result.current.request();
    });
    await waitFor(() => expect(result.current.status).toBe("requesting"));

    act(() => result.current.reset());

    await act(async () => {
      await result.current.request();
    });
    expect(requestKontorFaucet).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({
      commitTxid: "cc33",
      revealTxid: "dd44",
    });

    // And the first, abandoned response still lands nowhere.
    await act(async () => {
      release({ commitTxid: "aa11", revealTxid: "bb22" });
    });
    expect(result.current.result).toEqual({
      commitTxid: "cc33",
      revealTxid: "dd44",
    });
  });
});
