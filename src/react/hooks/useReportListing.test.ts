// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useReportListing } from "./useReportListing.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const ACCEPTED = {
  id: "rep_1",
  status: "pending" as const,
  atomicSwapId: "swap_1",
  duplicate: false,
};

describe("useReportListing", () => {
  let reportListing: ReturnType<typeof vi.fn>;
  let findReportableListingId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reportListing = vi.fn().mockResolvedValue(ACCEPTED);
    findReportableListingId = vi.fn().mockResolvedValue("swap_1");
    ctxRef.current = makeCtx({ client: { reportListing, findReportableListingId } });
  });

  it("mirrors the provider's sign-in as `canReport`", () => {
    const { result, rerender } = renderHook(() => useReportListing());
    expect(result.current.canReport).toBe(true);
    ctxRef.current = makeCtx({
      isAuthenticated: false,
      client: { reportListing, findReportableListingId },
    });
    rerender();
    expect(result.current.canReport).toBe(false);
  });

  it("posts straight away when the target is a swap id", async () => {
    const { result } = renderHook(() => useReportListing({ target: "swap_1" }));
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.submit({ reason: "scam", details: "fake" });
    });

    expect(findReportableListingId).not.toHaveBeenCalled();
    expect(reportListing).toHaveBeenCalledWith({
      atomicSwapId: "swap_1",
      reason: "scam",
      details: "fake",
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(ACCEPTED);
    expect(result.current.error).toBeNull();
  });

  it("resolves a token query to a listing before posting", async () => {
    const { result } = renderHook(() =>
      useReportListing({ target: { assetName: "RAREPEPE", listingType: "counterparty" } }),
    );
    await act(async () => {
      await result.current.submit({ reason: "illegal" });
    });
    expect(findReportableListingId).toHaveBeenCalledWith({
      assetName: "RAREPEPE",
      listingType: "counterparty",
    });
    expect(reportListing).toHaveBeenCalledWith({
      atomicSwapId: "swap_1",
      reason: "illegal",
      details: undefined,
    });
    expect(result.current.status).toBe("success");
  });

  it("ends in `unlisted` — not `error` — for a token no one ever listed", async () => {
    findReportableListingId.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useReportListing({ target: { assetName: "NEVERLISTED" } }),
    );
    await act(async () => {
      await result.current.submit({ reason: "spam" });
    });
    expect(reportListing).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unlisted");
    expect(result.current.error).toBeNull();
  });

  it("a target passed to submit() overrides the option", async () => {
    const { result } = renderHook(() => useReportListing({ target: "swap_1" }));
    await act(async () => {
      await result.current.submit({ reason: "hate", target: "swap_2" });
    });
    expect(reportListing).toHaveBeenCalledWith(
      expect.objectContaining({ atomicSwapId: "swap_2" }),
    );
  });

  it("refuses with an error when there is no target at all", async () => {
    const { result } = renderHook(() => useReportListing());
    await act(async () => {
      await result.current.submit({ reason: "other" });
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/nothing to report/i);
    expect(reportListing).not.toHaveBeenCalled();
  });

  it("lands a refusal in `error` instead of rejecting the press handler", async () => {
    reportListing.mockRejectedValue(new Error("HTTP 401: Unauthorized"));
    const { result } = renderHook(() => useReportListing({ target: "swap_1" }));
    await act(async () => {
      await result.current.submit({ reason: "scam" });
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toBe("HTTP 401: Unauthorized");
    expect(result.current.result).toBeNull();
  });

  it("ignores a second submit while one is in flight", async () => {
    let resolve!: (value: typeof ACCEPTED) => void;
    reportListing.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useReportListing({ target: "swap_1" }));

    let first!: Promise<void>;
    act(() => {
      first = result.current.submit({ reason: "scam" });
    });
    await waitFor(() => expect(result.current.status).toBe("submitting"));
    await act(async () => {
      await result.current.submit({ reason: "spam" });
    });
    expect(reportListing).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(ACCEPTED);
      await first;
    });
    expect(result.current.status).toBe("success");
  });

  it("reset() drops an in-flight result and returns to idle", async () => {
    let resolve!: (value: typeof ACCEPTED) => void;
    reportListing.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useReportListing({ target: "swap_1" }));

    let first!: Promise<void>;
    act(() => {
      first = result.current.submit({ reason: "scam" });
    });
    await waitFor(() => expect(result.current.status).toBe("submitting"));
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");

    await act(async () => {
      resolve(ACCEPTED);
      await first;
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();

    // And the guard was released: the next submit goes out.
    reportListing.mockResolvedValue(ACCEPTED);
    await act(async () => {
      await result.current.submit({ reason: "scam" });
    });
    expect(reportListing).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("success");
  });
});
