import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";
import type { AtomicSwap } from "../types/index.js";
import { makeSigner } from "../test-utils.js";

// Mock the Kontor helpers directly so we can drive the offer/accept/record flow
// (and its error branches) without a real session or network. buy-kontor.ts has
// no direct @kontor/sdk import, so mocking these helper modules is sufficient.
const { mockMakeSession, mockKontorBuy, mockGetSigning, mockResolveFunding } =
  vi.hoisted(() => ({
    mockMakeSession: vi.fn(),
    mockKontorBuy: vi.fn(),
    mockGetSigning: vi.fn(),
    mockResolveFunding: vi.fn(),
  }));

vi.mock("../kontor/session.js", () => ({ makeKontorSession: mockMakeSession }));
vi.mock("../kontor/signing.js", () => ({ getKontorSigning: mockGetSigning }));
vi.mock("../kontor/funding.js", () => ({
  resolveKontorFunding: mockResolveFunding,
}));
vi.mock("../api/kontor.js", () => ({ kontorBuy: mockKontorBuy }));

import { fillKontorSwap, KontorPurchaseNotRecordedError } from "./buy-kontor.js";

const TXID = "ab".repeat(32);
const ctx = {
  chain: "signet",
  indexerUrl: "https://ix",
  btcNetwork: {},
} as unknown as KontorContext;
const http = {} as unknown as HttpClient;

function baseSwap(overrides: Record<string, unknown> = {}): AtomicSwap {
  return {
    id: "swap1",
    kontorOfferBlob: '{"v":1}',
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
