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
} = vi.hoisted(() => ({
  mockMakeSession: vi.fn(),
  mockGetSigning: vi.fn(),
  mockResolveFunding: vi.fn(),
  mockStartDelist: vi.fn(),
  mockConfirmDelist: vi.fn(),
  mockRevoke: vi.fn(),
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

import { delistKontorSwap, KontorDelistNotRecordedError } from "./delist-kontor.js";

const ctx = {
  chain: "signet",
  indexerUrl: "https://ix",
  btcNetwork: {},
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
