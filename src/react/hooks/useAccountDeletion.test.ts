// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useAccountDeletion } from "./useAccountDeletion.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const ACCEPTED = {
  id: "del_1",
  status: "pending" as const,
  duplicate: false,
  verified: null,
};

describe("useAccountDeletion", () => {
  let requestAccountDeletion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestAccountDeletion = vi.fn().mockResolvedValue(ACCEPTED);
    ctxRef.current = makeCtx({ client: { requestAccountDeletion } });
  });

  it("names the connected wallet's addresses by default", () => {
    const { result } = renderHook(() => useAccountDeletion());
    expect(result.current.walletAddresses).toEqual(["bc1qwallet", "bc1pwallet"]);
    expect(result.current.canProveOwnership).toBe(true);
    expect(result.current.status).toBe("idle");
  });

  it("names none with no wallet connected — the flow still works", () => {
    ctxRef.current = makeCtx({
      addresses: null,
      isAuthenticated: false,
      client: { requestAccountDeletion },
    });
    const { result } = renderHook(() => useAccountDeletion());
    expect(result.current.walletAddresses).toEqual([]);
    expect(result.current.canProveOwnership).toBe(false);
  });

  it("lets the caller replace the wallet's addresses", () => {
    const { result } = renderHook(() =>
      useAccountDeletion({ addresses: ["bc1qother"] }),
    );
    expect(result.current.walletAddresses).toEqual(["bc1qother"]);
  });

  it("adds the form's addresses to the wallet's rather than replacing them", async () => {
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit({
        email: "  me@example.com ",
        addresses: ["bc1qtyped"],
        message: "no longer trading",
      });
    });

    expect(requestAccountDeletion).toHaveBeenCalledWith({
      email: "me@example.com",
      addresses: ["bc1qwallet", "bc1pwallet", "bc1qtyped"],
      message: "no longer trading",
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(ACCEPTED);
    expect(result.current.error).toBeNull();
  });

  it("submits the wallet's addresses alone when nothing was typed", async () => {
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit();
    });
    expect(requestAccountDeletion).toHaveBeenCalledWith({
      addresses: ["bc1qwallet", "bc1pwallet"],
    });
  });

  it("reports an empty request as `invalid`, without a round-trip", async () => {
    ctxRef.current = makeCtx({
      addresses: null,
      isAuthenticated: false,
      client: { requestAccountDeletion },
    });
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit({ email: "   " });
    });
    expect(requestAccountDeletion).not.toHaveBeenCalled();
    expect(result.current.status).toBe("invalid");
    expect(result.current.error).toBeNull();
  });

  it("keeps a duplicate as a success — the standing request is the answer", async () => {
    const duplicate = { ...ACCEPTED, id: null, duplicate: true, verified: true };
    requestAccountDeletion.mockResolvedValue(duplicate);
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit({ email: "me@example.com" });
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(duplicate);
  });

  it("lands a refusal in `error` rather than rejecting", async () => {
    requestAccountDeletion.mockRejectedValue(new Error("Too many requests"));
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit({ email: "me@example.com" });
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("Too many requests");
    expect(result.current.result).toBeNull();
  });

  it("ignores a second submit while one is in flight", async () => {
    let release: (() => void) | undefined;
    requestAccountDeletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ACCEPTED);
        }),
    );
    const { result } = renderHook(() => useAccountDeletion());
    act(() => {
      void result.current.submit({ email: "me@example.com" });
    });
    await waitFor(() => expect(result.current.status).toBe("submitting"));
    await act(async () => {
      await result.current.submit({ email: "me@example.com" });
    });
    expect(requestAccountDeletion).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("drops a response the user has already walked away from", async () => {
    let release: ((value: typeof ACCEPTED) => void) | undefined;
    requestAccountDeletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useAccountDeletion());
    act(() => {
      void result.current.submit({ email: "me@example.com" });
    });
    await waitFor(() => expect(result.current.status).toBe("submitting"));

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");

    await act(async () => {
      release?.(ACCEPTED);
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
  });

  it("reset() clears the last outcome and re-arms submit", async () => {
    const { result } = renderHook(() => useAccountDeletion());
    await act(async () => {
      await result.current.submit({ email: "me@example.com" });
    });
    expect(result.current.status).toBe("success");

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();

    await act(async () => {
      await result.current.submit({ email: "me@example.com" });
    });
    expect(requestAccountDeletion).toHaveBeenCalledTimes(2);
  });
});
