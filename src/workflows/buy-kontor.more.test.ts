import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";
import type { AtomicSwap } from "../types/index.js";
import { makeSigner } from "../test-utils.js";

// Mock the Kontor helpers directly so we can drive the offer/accept/record flow
// (and its error branches) without a real session or network. buy-kontor.ts has
// no direct @kontor/sdk import, so mocking these helper modules is sufficient.
const {
  mockMakeSession,
  mockKontorBuy,
  mockGetSigning,
  mockResolveFunding,
  mockPreflight,
} = vi.hoisted(() => ({
  mockMakeSession: vi.fn(),
  mockKontorBuy: vi.fn(),
  mockGetSigning: vi.fn(),
  mockResolveFunding: vi.fn(),
  mockPreflight: vi.fn(),
}));

vi.mock("../kontor/session.js", () => ({ makeKontorSession: mockMakeSession }));
vi.mock("../kontor/signing.js", () => ({ getKontorSigning: mockGetSigning }));
vi.mock("../kontor/funding.js", () => ({
  resolveKontorFunding: mockResolveFunding,
}));
// The pre-flight's chain reads have their own suite (`kontor/preflight.test.ts`);
// here it is stubbed so these tests stay about the offer/accept/record flow —
// except in "pre-flight gate" below, which drives it refusing.
vi.mock("../kontor/preflight.js", () => ({
  preflightKontorPurchase: mockPreflight,
}));
vi.mock("../api/kontor.js", () => ({ kontorBuy: mockKontorBuy }));

/** A pre-flight verdict, `ok` unless handed a refusal to report. */
function verdict(error: Error | null = null) {
  return {
    ok: error === null,
    error,
    balanceKor: "1",
    requiredKor: "0.00005",
    gasLimit: 50_000,
    signerId: 12,
  };
}


import { fillKontorSwap, KontorPurchaseNotRecordedError } from "./buy-kontor.js";

const TXID = "ab".repeat(32);
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
    kontorOfferBlob: '{"v":1}',
    assetUtxoId: `${"cd".repeat(32)}:0`,
    kontorAssetKind: "nft",
    kontorNftId: "nft-1",
    kontorContractAddress: "nft@0.0",
    kontorAmount: null,
    ...overrides,
  } as unknown as AtomicSwap;
}

function makeSession(over: Record<string, unknown> = {}) {
  return {
    identity: { address: "tb1pbuyeridentity" },
    openOffer: vi.fn(() => ({
      inspect: vi.fn(async () => ({ valid: true })),
      accept: vi.fn(async () => ({ txid: TXID })),
    })),
    close: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSigning.mockResolvedValue({ identity: { address: "tb1pbuyeridentity" } });
  mockResolveFunding.mockReturnValue({ kind: "query" });
  mockPreflight.mockResolvedValue(verdict());
});

describe("fillKontorSwap guard throws", () => {
  it("throws when the swap has no Kontor offer blob", async () => {
    await expect(
      fillKontorSwap(
        baseSwap({ kontorOfferBlob: null }),
        {},
        http,
        makeSigner({ p2tr: "tb1pbuyer" }),
        ctx,
      ),
    ).rejects.toThrow(/no offer blob/);
  });

  it("throws when the signer has no P2TR address", async () => {
    await expect(
      fillKontorSwap(baseSwap(), {}, http, makeSigner(), ctx),
    ).rejects.toThrow(/P2TR address/);
  });
});

describe("fillKontorSwap pre-flight gate", () => {
  it("asks the one shared pre-flight, with the listing's escrow and asset", async () => {
    // Same call `client.preflightKontorPurchase()` makes: a review screen and
    // the broadcast gate cannot disagree, because there is only one check.
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockKontorBuy.mockResolvedValue({ txId: TXID, atomicSwap: { id: "swap1" } });

    await fillKontorSwap(
      baseSwap(),
      {},
      http,
      makeSigner({ p2tr: "tb1pbuyer" }),
      ctx,
    );

    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        indexerUrl: ctx.indexerUrl,
        // The client's own `fetch`, not `globalThis.fetch`: a host that supplied
        // one has it honoured by every other indexer read, and a signer lookup
        // that can't reach the indexer *throws* — so bypassing it here would
        // block the very purchase this check exists to protect.
        fetch: ctxFetch,
        escrowOutpoint: `${"cd".repeat(32)}:0`,
        assetKind: "nft",
        nftId: "nft-1",
      }),
    );
  });

  it("aborts before accepting when the buyer cannot pay the gas", async () => {
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockPreflight.mockResolvedValue(
      verdict(new Error("Not enough KOR to pay Kontor network gas")),
    );

    const events: Array<{ step: string; phase: string }> = [];
    await expect(
      fillKontorSwap(
        baseSwap(),
        {},
        http,
        makeSigner({ p2tr: "tb1pbuyer" }),
        ctx,
        { onProgress: (e) => events.push(e) },
      ),
    ).rejects.toThrow(/Not enough KOR/);

    // Nothing signed, nothing broadcast, nothing recorded — and the session is
    // still closed.
    expect(session.openOffer).not.toHaveBeenCalled();
    expect(mockKontorBuy).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
    expect(
      events.some((e) => e.step === "preflightKontor" && e.phase === "error"),
    ).toBe(true);
  });

  it("aborts before accepting when the escrow holds nothing", async () => {
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockPreflight.mockResolvedValue(
      verdict(new Error("This Kontor listing is not backed on-chain")),
    );

    await expect(
      fillKontorSwap(baseSwap(), {}, http, makeSigner({ p2tr: "tb1pbuyer" }), ctx),
    ).rejects.toThrow(/not backed on-chain/);
    expect(session.openOffer).not.toHaveBeenCalled();
    expect(mockKontorBuy).not.toHaveBeenCalled();
  });

  it("propagates a failure to *check* — an unreadable indexer is not a verdict", async () => {
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockPreflight.mockRejectedValue(new Error("Kontor signer lookup failed"));

    await expect(
      fillKontorSwap(baseSwap(), {}, http, makeSigner({ p2tr: "tb1pbuyer" }), ctx),
    ).rejects.toThrow(/signer lookup failed/);
    expect(session.openOffer).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });

  it("forwards a listing with no recorded escrow outpoint as such", async () => {
    // The pre-flight decides what to do with a missing outpoint (gas only); the
    // workflow's job is just to pass on what the listing actually recorded.
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockKontorBuy.mockResolvedValue({ txId: TXID, atomicSwap: { id: "swap1" } });

    await fillKontorSwap(
      baseSwap({ assetUtxoId: null }),
      {},
      http,
      makeSigner({ p2tr: "tb1pbuyer" }),
      ctx,
    );

    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ escrowOutpoint: null }),
    );
  });
});

describe("fillKontorSwap offer inspection", () => {
  it("throws the offer problem when inspection is invalid", async () => {
    const session = makeSession({
      openOffer: vi.fn(() => ({
        inspect: vi.fn(async () => ({ valid: false, problem: "expired offer" })),
        accept: vi.fn(),
      })),
    });
    mockMakeSession.mockReturnValue(session);

    await expect(
      fillKontorSwap(baseSwap(), {}, http, makeSigner({ p2tr: "tb1pbuyer" }), ctx),
    ).rejects.toThrow(/expired offer/);
    // The session is always closed in the finally block.
    expect(session.close).toHaveBeenCalled();
  });

  it("throws a default message when the offer is invalid without a problem string", async () => {
    const session = makeSession({
      openOffer: vi.fn(() => ({
        inspect: vi.fn(async () => ({ valid: false })),
        accept: vi.fn(),
      })),
    });
    mockMakeSession.mockReturnValue(session);

    await expect(
      fillKontorSwap(baseSwap(), {}, http, makeSigner({ p2tr: "tb1pbuyer" }), ctx),
    ).rejects.toThrow(/no longer valid/);
  });
});

describe("fillKontorSwap recording failure", () => {
  it("wraps a failed purchase recording in KontorPurchaseNotRecordedError carrying the txid", async () => {
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    const cause = new Error("recording 500");
    mockKontorBuy.mockRejectedValue(cause);

    const err = await fillKontorSwap(
      baseSwap(),
      { satsPerVbyte: 5 },
      http,
      makeSigner({ p2tr: "tb1pbuyer" }),
      ctx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(KontorPurchaseNotRecordedError);
    expect(err.swapId).toBe("swap1");
    expect(err.txId).toBe(TXID);
    expect(err.buyerAddress).toBe("tb1pbuyeridentity");
    expect(err.cause).toBe(cause);
    expect(session.close).toHaveBeenCalled();
  });
});

describe("fillKontorSwap happy path", () => {
  it("returns the recorded pending sale and emits accept/submit progress", async () => {
    const session = makeSession();
    mockMakeSession.mockReturnValue(session);
    mockKontorBuy.mockResolvedValue({
      txId: TXID,
      buyerAddress: "tb1pbuyeridentity",
      atomicSwap: { id: "swap1" },
    });

    const events: Array<{ step: string; phase: string }> = [];
    const sales = await fillKontorSwap(
      baseSwap(),
      {},
      http,
      makeSigner({ p2tr: "tb1pbuyer" }),
      ctx,
      { onProgress: (e) => events.push(e) },
    );

    expect(sales).toHaveLength(1);
    expect(sales[0].txId).toBe(TXID);
    expect(mockKontorBuy).toHaveBeenCalledWith(http, "swap1", {
      buyerAddress: "tb1pbuyeridentity",
      txId: TXID,
    });
    expect(
      events.some(
        (e) => e.step === "acceptKontorOffer" && e.phase === "complete",
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.step === "submitPurchase" && e.phase === "complete"),
    ).toBe(true);
    expect(session.close).toHaveBeenCalled();
  });
});
