// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, waitFor, type CtxRef } from "../hook-test-utils.js";
import { useKontorMinerFee } from "./useKontorMinerFee.js";
import { FALLBACK_REVEAL_VSIZE } from "./kontorFeeEstimate.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

// A minimal, well-formed (non-witness) reveal tx hex + its measured vsize
// (1 input, 1 P2WPKH output). Precomputed via bitcoinjs-lib so the test avoids
// building txs under jsdom, whose realm's Uint8Array trips bitcoinjs validation.
const REVEAL_HEX =
  "020000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff01e803000000000000160014abababababababababababababababababababab00000000";
const REVEAL_VSIZE = 82;

/** A same-kind offer blob carrying a parseable attach-reveal hex. */
function buildRevealBlob(): { blob: string; vsize: number } {
  return {
    blob: JSON.stringify({ attachReveal: REVEAL_HEX }),
    vsize: REVEAL_VSIZE,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Build a context whose client.listSwaps resolves to the given swaps. */
function ctxWithSwaps(atomicSwaps: unknown[], listSwaps = vi.fn()) {
  listSwaps.mockResolvedValue({ atomicSwaps });
  ctxRef.current = makeCtx({
    client: { listSwaps } as never,
  });
  return listSwaps;
}

describe("useKontorMinerFee", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is idle and does not fetch when disabled", async () => {
    const listSwaps = vi.fn();
    ctxRef.current = makeCtx({ client: { listSwaps } as never });

    const { result } = renderHook(() => useKontorMinerFee("token", false));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBeNull();
    expect(result.current.calibrated).toBe(false);
    expect(listSwaps).not.toHaveBeenCalled();
  });

  it("is idle when kind is null", async () => {
    const listSwaps = vi.fn();
    ctxRef.current = makeCtx({ client: { listSwaps } as never });

    const { result } = renderHook(() => useKontorMinerFee(null, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBeNull();
    expect(listSwaps).not.toHaveBeenCalled();
  });

  it("is idle when the client is not initialized", async () => {
    ctxRef.current = makeCtx({ client: null });

    const { result } = renderHook(() => useKontorMinerFee("token", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBeNull();
    expect(result.current.calibrated).toBe(false);
  });

  it("calibrates the reveal vsize from a matching same-kind listing", async () => {
    const { blob, vsize } = buildRevealBlob();
    const listSwaps = ctxWithSwaps([
      { kontorAssetKind: "nft", kontorOfferBlob: "irrelevant" },
      { kontorAssetKind: "token", kontorOfferBlob: blob },
    ]);

    const { result } = renderHook(() => useKontorMinerFee("token", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBe(vsize);
    expect(result.current.calibrated).toBe(true);
    expect(listSwaps).toHaveBeenCalledWith(
      { listingType: "kontor", limit: 20 },
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("calibrates for the nft kind from a matching nft listing", async () => {
    const { blob, vsize } = buildRevealBlob();
    ctxWithSwaps([{ kontorAssetKind: "nft", kontorOfferBlob: blob }]);

    const { result } = renderHook(() => useKontorMinerFee("nft", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBe(vsize);
    expect(result.current.calibrated).toBe(true);
  });

  it("falls back to the baked vsize when no same-kind listing is found", async () => {
    ctxWithSwaps([
      { kontorAssetKind: "nft", kontorOfferBlob: "blob" },
      { kontorAssetKind: "token", kontorOfferBlob: null },
    ]);

    const { result } = renderHook(() => useKontorMinerFee("token", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBe(FALLBACK_REVEAL_VSIZE.token);
    expect(result.current.calibrated).toBe(false);
  });

  it("falls back when the matching listing's offer blob is unparseable", async () => {
    ctxWithSwaps([{ kontorAssetKind: "token", kontorOfferBlob: "not json {" }]);

    const { result } = renderHook(() => useKontorMinerFee("token", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBe(FALLBACK_REVEAL_VSIZE.token);
    expect(result.current.calibrated).toBe(false);
  });

  it("falls back to the baked vsize when listSwaps rejects", async () => {
    const listSwaps = vi.fn().mockRejectedValue(new Error("network down"));
    ctxRef.current = makeCtx({ client: { listSwaps } as never });

    const { result } = renderHook(() => useKontorMinerFee("nft", true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.revealVsize).toBe(FALLBACK_REVEAL_VSIZE.nft);
    expect(result.current.calibrated).toBe(false);
  });

  it("is loading while the request is in flight", async () => {
    const d = deferred<{ atomicSwaps: unknown[] }>();
    const listSwaps = vi.fn().mockReturnValue(d.promise);
    ctxRef.current = makeCtx({ client: { listSwaps } as never });

    const { result } = renderHook(() => useKontorMinerFee("token", true));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.revealVsize).toBeNull();

    d.resolve({ atomicSwaps: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.revealVsize).toBe(FALLBACK_REVEAL_VSIZE.token);
  });

  it("recomputes when enabled flips from false to true", async () => {
    const listSwaps = ctxWithSwaps([]);

    const { result, rerender } = renderHook(
      ({ enabled }) => useKontorMinerFee("token", enabled),
      { initialProps: { enabled: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listSwaps).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(listSwaps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.revealVsize).toBe(FALLBACK_REVEAL_VSIZE.token),
    );
  });

  it("ignores a stale response when the kind changes mid-flight", async () => {
    const first = deferred<{ atomicSwaps: unknown[] }>();
    const second = deferred<{ atomicSwaps: unknown[] }>();
    const { blob, vsize } = buildRevealBlob();
    const listSwaps = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    ctxRef.current = makeCtx({ client: { listSwaps } as never });

    const { result, rerender } = renderHook(
      ({ kind }) => useKontorMinerFee(kind, true),
      { initialProps: { kind: "token" as "token" | "nft" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    rerender({ kind: "nft" });
    // Resolve the stale (token) request AFTER the kind switched — it must not win.
    first.resolve({
      atomicSwaps: [{ kontorAssetKind: "token", kontorOfferBlob: blob }],
    });
    second.resolve({
      atomicSwaps: [{ kontorAssetKind: "nft", kontorOfferBlob: blob }],
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.calibrated).toBe(true);
    expect(result.current.revealVsize).toBe(vsize);
    expect(listSwaps).toHaveBeenCalledTimes(2);
  });
});
