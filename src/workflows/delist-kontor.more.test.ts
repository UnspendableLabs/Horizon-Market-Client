import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";
import type { AtomicSwap } from "../types/index.js";
import { makeSigner } from "../test-utils.js";

// delist-kontor.ts imports { Offer } from "@kontor/sdk" directly, so that module
// must be mocked too. The rest is the Kontor-helper + delist-API surface.
const {
  mockMakeSession,
  mockGetSigning,
  mockResolveFunding,
  mockStartDelist,
  mockConfirmDelist,
  mockRevoke,
  mockPreflight,
} = vi.hoisted(() => ({
  mockMakeSession: vi.fn(),
  mockGetSigning: vi.fn(),
  mockResolveFunding: vi.fn(),
  mockStartDelist: vi.fn(),
  mockConfirmDelist: vi.fn(),
  mockRevoke: vi.fn(),
  mockPreflight: vi.fn(),
}));

vi.mock("@kontor/sdk", () => ({
  Offer: class {
    constructor(_session: unknown, _data: unknown) {}
    revoke() {
      return mockRevoke();
    }
  },
}));
vi.mock("../kontor/session.js", () => ({ makeKontorSession: mockMakeSession }));
vi.mock("../kontor/signing.js", () => ({ getKontorSigning: mockGetSigning }));
vi.mock("../kontor/funding.js", () => ({
  resolveKontorFunding: mockResolveFunding,
}));
vi.mock("../api/delist.js", () => ({
  startDelist: mockStartDelist,
  confirmDelist: mockConfirmDelist,
}));
// The pre-flight's chain reads have their own suite (`kontor/preflight.test.ts`);
// stubbed here except in "pre-flight gate" below, which drives it refusing.
vi.mock("../kontor/preflight.js", () => ({
  preflightKontorDelist: mockPreflight,
}));

/** A pre-flight verdict, `ok` unless handed a refusal to report. */
function verdict(error: Error | null = null) {
  return {
    ok: error === null,
    error,
    balanceKor: "1",
    requiredKor: "0.0001",
    gasLimit: 100_000,
    signerId: 16,
  };
}

import { delistKontorSwap, KontorDelistNotRecordedError } from "./delist-kontor.js";

// A distinguishable `fetch`: the pre-flight's signer lookup must go through
// the client's, not `globalThis.fetch`.
const ctxFetch = (() => Promise.reject(new Error("unused"))) as unknown as typeof globalThis.fetch;
const ctx = {
  chain: "signet",
  indexerUrl: "https://ix",
  btcNetwork: {},
  fetch: ctxFetch,
} as unknown as KontorContext;
const http = {} as unknown as HttpClient;

function baseSwap(overrides: Record<string, unknown> = {}): AtomicSwap {
  return {
    id: "swap1",
    sellerAddress: "tb1pseller",
    kontorOfferBlob: '{"v":1}',
    ...overrides,
  } as unknown as AtomicSwap;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSigning.mockResolvedValue({ identity: { address: "tb1pseller" } });
  mockResolveFunding.mockReturnValue({ kind: "query" });
  mockRevoke.mockResolvedValue({ txid: "cd".repeat(32) });
  mockMakeSession.mockReturnValue({ close: vi.fn() });
  mockPreflight.mockResolvedValue(verdict());
});

describe("delistKontorSwap pre-flight gate", () => {
  it("asks the one shared pre-flight, handing it the offer blob it will revoke", async () => {
    // Same call `client.preflightKontorDelist()` makes — and the blob is what
    // prices the detach's gas, so it must be the listing's own.
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    mockStartDelist.mockResolvedValue({
      id: "dr_1",
      atomicSwap: { id: "swap1", sellerAddress: "tb1pseller" },
    });
    mockConfirmDelist.mockResolvedValue({ id: "dr_1" });

    await delistKontorSwap(baseSwap(), {}, http, makeSigner(), ctx);

    expect(mockPreflight).toHaveBeenCalledWith(
      // `fetch` is the client's own — see buy-kontor.more.test.ts for why
      // bypassing it would block the delist this check exists to protect.
      expect.objectContaining({
        session,
        offerBlob: '{"v":1}',
        fetch: ctxFetch,
      }),
    );
  });

  it("aborts before the revoke spends the escrow when the seller cannot pay the gas", async () => {
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    mockPreflight.mockResolvedValue(
      verdict(new Error("Not enough KOR to pay Kontor network gas")),
    );

    const events: Array<{ step: string; phase: string }> = [];
    await expect(
      delistKontorSwap(baseSwap(), {}, http, makeSigner(), ctx, {
        onProgress: (e) => events.push(e),
      }),
    ).rejects.toThrow(/Not enough KOR/);

    // The escrow UTXO is untouched — a revoke without gas would spend it and
    // strand the asset at an outpoint that no longer exists, unrecoverably.
    expect(mockRevoke).not.toHaveBeenCalled();
    // Nor is the listing marked delisted server-side: nothing happened at all.
    expect(mockStartDelist).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
    expect(
      events.some((e) => e.step === "preflightKontor" && e.phase === "error"),
    ).toBe(true);
  });

  it("does not wrap a blocked delist in KontorDelistNotRecordedError", async () => {
    // That error means "the escrow IS reclaimed, only the server call failed".
    // Reporting it for a pre-flight failure would send the seller down the
    // recovery path for an on-chain event that never happened.
    mockMakeSession.mockReturnValue({ close: vi.fn() });
    mockPreflight.mockResolvedValue(verdict(new Error("Not enough KOR")));

    const err = await delistKontorSwap(
      baseSwap(),
      {},
      http,
      makeSigner(),
      ctx,
    ).catch((e) => e);

    expect(err).not.toBeInstanceOf(KontorDelistNotRecordedError);
  });

  it("propagates a failure to *check* — an unreadable indexer is not a verdict", async () => {
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    mockPreflight.mockRejectedValue(new Error("Kontor signer lookup failed"));

    await expect(
      delistKontorSwap(baseSwap(), {}, http, makeSigner(), ctx),
    ).rejects.toThrow(/signer lookup failed/);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });
});

describe("delistKontorSwap guard", () => {
  it("throws when the swap has no Kontor offer blob", async () => {
    await expect(
      delistKontorSwap(
        baseSwap({ kontorOfferBlob: null }),
        {},
        http,
        makeSigner(),
        ctx,
      ),
    ).rejects.toThrow(/no offer blob/);
  });
});

describe("delistKontorSwap server-delist failure", () => {
  it("wraps a failed server delist in KontorDelistNotRecordedError after the on-chain revoke", async () => {
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    const cause = new Error("startDelist 500");
    mockStartDelist.mockRejectedValue(cause);

    const err = await delistKontorSwap(
      baseSwap(),
      {},
      http,
      makeSigner(),
      ctx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(KontorDelistNotRecordedError);
    expect(err.swapId).toBe("swap1");
    expect(err.cause).toBe(cause);
    // The revoke (on-chain reclaim) happened before the server delist failed.
    expect(mockRevoke).toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });
});

describe("delistKontorSwap happy path", () => {
  it("revokes on-chain then completes the BIP322 delist", async () => {
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    mockStartDelist.mockResolvedValue({
      id: "dr_1",
      atomicSwap: { id: "swap1", sellerAddress: "tb1pseller" },
    });
    mockConfirmDelist.mockResolvedValue({ id: "dr_1", signature: "sig" });
    const signer = makeSigner();

    await delistKontorSwap(baseSwap(), {}, http, signer, ctx);

    expect(mockRevoke).toHaveBeenCalled();
    expect(signer.signMessage).toHaveBeenCalledWith("tb1pseller", "dr_1");
    expect(mockConfirmDelist).toHaveBeenCalledWith(http, "dr_1", "base64sig==");
    expect(session.close).toHaveBeenCalled();
  });
});
