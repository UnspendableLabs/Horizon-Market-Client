// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { Addresses } from "../context.js";
import { useLoginPanel } from "./useLoginPanel.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const ADDRS = {
  p2wpkh: "bc1qlogin",
  p2tr: "bc1plogin",
  publicKey: "02ff",
} as unknown as Addresses;

describe("useLoginPanel", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probes for a session on mount and stays on the form when none exists", async () => {
    const getPrivateKey = vi.fn().mockResolvedValue("");
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() => useLoginPanel({ getPrivateKey }));
    await waitFor(() => expect(getPrivateKey).toHaveBeenCalledWith(""));
    await waitFor(() => expect(result.current.phase).toBe("form"));
    expect(ctxRef.current!.initialize).not.toHaveBeenCalled();
  });

  it("restores an existing session found by the probe", async () => {
    const getPrivateKey = vi.fn().mockResolvedValue("priv-key");
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() => useLoginPanel({ getPrivateKey }));
    await waitFor(() => expect(result.current.phase).toBe("success"));
    expect(ctxRef.current!.initialize).toHaveBeenCalledWith("priv-key");
  });

  it("swallows a probe error and returns to the form", async () => {
    const getPrivateKey = vi.fn().mockRejectedValue(new Error("probe boom"));
    const onError = vi.fn();
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() =>
      useLoginPanel({ getPrivateKey, onError }),
    );
    await waitFor(() => expect(getPrivateKey).toHaveBeenCalled());
    await waitFor(() => expect(result.current.phase).toBe("form"));
    expect(onError).not.toHaveBeenCalled();
    expect(ctxRef.current!.initialize).not.toHaveBeenCalled();
  });

  it("goes straight to success when a wallet is already connected", async () => {
    const getPrivateKey = vi.fn();
    const onSuccess = vi.fn();
    ctxRef.current = makeCtx({ addresses: ADDRS });

    const { result, rerender } = renderHook(() =>
      useLoginPanel({ getPrivateKey, onSuccess }),
    );
    await waitFor(() => expect(result.current.phase).toBe("success"));
    expect(getPrivateKey).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(ADDRS);

    // A re-render with the same addresses must not re-fire onSuccess.
    rerender();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not probe when autoDetectSession is false", async () => {
    const getPrivateKey = vi.fn();
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() =>
      useLoginPanel({ getPrivateKey, autoDetectSession: false }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("form");
    expect(getPrivateKey).not.toHaveBeenCalled();
  });

  it("connect() runs the interactive flow with the current email", async () => {
    const getPrivateKey = vi.fn().mockResolvedValue("interactive-key");
    const onSuccess = vi.fn();
    ctxRef.current = makeCtx({ addresses: ADDRS });

    const { result } = renderHook(() =>
      useLoginPanel({
        getPrivateKey,
        autoDetectSession: false,
        onSuccess,
      }),
    );

    act(() => result.current.setEmail("user@example.com"));
    expect(result.current.email).toBe("user@example.com");

    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.phase).toBe("success"));
    expect(getPrivateKey).toHaveBeenCalledWith("user@example.com");
    expect(ctxRef.current!.initialize).toHaveBeenCalledWith("interactive-key");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(ADDRS);
  });

  it("connect() surfaces a missing key as an error (no onError required)", async () => {
    const getPrivateKey = vi.fn().mockResolvedValue("");
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() =>
      useLoginPanel({ getPrivateKey, autoDetectSession: false }),
    );
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error?.message).toBe("No private key returned");
  });

  it("connect() reports a thrown Error via onError", async () => {
    const getPrivateKey = vi.fn().mockRejectedValue(new Error("network down"));
    const onError = vi.fn();
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() =>
      useLoginPanel({ getPrivateKey, autoDetectSession: false, onError }),
    );
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error?.message).toBe("network down");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("connect() wraps a non-Error rejection", async () => {
    const getPrivateKey = vi.fn().mockRejectedValue("string failure");
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() =>
      useLoginPanel({ getPrivateKey, autoDetectSession: false }),
    );
    await act(async () => {
      result.current.connect();
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("string failure");
  });

  it("resets to the form when the wallet disconnects", async () => {
    const getPrivateKey = vi.fn();
    ctxRef.current = makeCtx({ addresses: ADDRS });

    const { result, rerender } = renderHook(() =>
      useLoginPanel({ getPrivateKey }),
    );
    await waitFor(() => expect(result.current.phase).toBe("success"));

    // Simulate logout: addresses become null.
    ctxRef.current = makeCtx({ addresses: null });
    rerender();
    await waitFor(() => expect(result.current.phase).toBe("form"));
    expect(result.current.error).toBeNull();
  });
});
