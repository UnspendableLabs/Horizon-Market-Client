import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";
import type { KontorSellParams } from "./sell-kontor.js";
import { makeSigner } from "../test-utils.js";

// Mock every Kontor helper sell-kontor.ts touches. It has no direct @kontor/sdk
// import (offer composition goes through ../kontor/contracts.js), so mocking the
// helper modules lets us exercise the validation guards and the not-recorded
// error path without a real session/network.
const {
  mockMakeSession,
  mockGetSigning,
  mockResolveFunding,
  mockFeeQuote,
  mockCreateSwap,
  mockBindToken,
  mockBindNft,
  mockAttachEscrow,
  mockNativeToken,
  mockPreflight,
} = vi.hoisted(() => ({
  mockMakeSession: vi.fn(),
  mockGetSigning: vi.fn(),
  mockResolveFunding: vi.fn(),
  mockFeeQuote: vi.fn(),
  mockCreateSwap: vi.fn(),
  mockBindToken: vi.fn(),
  mockBindNft: vi.fn(),
  mockAttachEscrow: vi.fn(),
  mockNativeToken: vi.fn(),
  mockPreflight: vi.fn(),
}));

vi.mock("../kontor/session.js", () => ({ makeKontorSession: mockMakeSession }));
vi.mock("../kontor/signing.js", () => ({ getKontorSigning: mockGetSigning }));
vi.mock("../kontor/funding.js", () => ({
  resolveKontorFunding: mockResolveFunding,
}));
vi.mock("../api/kontor.js", () => ({
  createKontorFeeQuote: mockFeeQuote,
  createKontorSwap: mockCreateSwap,
}));
vi.mock("../kontor/contracts.js", () => ({
  bindKontorToken: mockBindToken,
  bindKontorNft: mockBindNft,
  attachRevealEscrowFromBlob: mockAttachEscrow,
  Decimal: { from: (v: string) => ({ __decimal: v }) },
}));
vi.mock("../kontor/chain.js", () => ({
  kontorNativeTokenAddress: mockNativeToken,
}));
// The pre-flight's chain reads have their own suite (`kontor/preflight.test.ts`);
// stubbed here so these tests stay about the escrow/record flow — except in
// "pre-flight gate" below, which drives it refusing.
vi.mock("../kontor/preflight.js", () => ({
  preflightKontorListing: mockPreflight,
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

import {
  openKontorSellOrder,
  KontorListingNotRecordedError,
} from "./sell-kontor.js";

const P2TR = "tb1pseller";
const ESCROW_TXID = "aa".repeat(32);
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

const tokenParams = {
  listingType: "kontor",
  kontorAssetKind: "token",
  korAmount: "100",
  priceSats: 50000,
} as unknown as KontorSellParams;

const nftParams = {
  listingType: "kontor",
  kontorAssetKind: "nft",
  nftId: "nft-1",
  nftContractAddress: "nft@0.0",
  priceSats: 50000,
} as unknown as KontorSellParams;

beforeEach(() => {
  vi.resetAllMocks();
  mockGetSigning.mockResolvedValue({ identity: { address: P2TR } });
  mockResolveFunding.mockReturnValue({ kind: "query" });
  mockMakeSession.mockReturnValue({ close: vi.fn() });
  mockFeeQuote.mockResolvedValue({
    feePaymentId: "fp_1",
    paymentAddress: "tb1qfee",
    paymentAmount: 700,
    feeWaived: false,
  });
  mockNativeToken.mockReturnValue("token@0.0");
  mockBindToken.mockReturnValue({
    attachment: () => ({ offer: async () => ({ serialize: () => "OFFERBLOB" }) }),
  });
  mockBindNft.mockReturnValue({
    attachment: () => ({ offer: async () => ({ serialize: () => "NFTBLOB" }) }),
  });
  mockAttachEscrow.mockReturnValue({ txid: ESCROW_TXID, value: 600 });
  mockPreflight.mockResolvedValue(verdict());
});

describe("openKontorSellOrder pre-flight gate", () => {
  it("asks the one shared pre-flight, with the asset it is about to escrow", async () => {
    // Same call `client.preflightKontorListing()` makes: a review screen and the
    // broadcast gate cannot disagree, because there is only one check.
    mockCreateSwap.mockResolvedValue({ swap: { id: "s1" }, created: true });

    await openKontorSellOrder(tokenParams, http, makeSigner({ p2tr: P2TR }), ctx);

    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        indexerUrl: ctx.indexerUrl,
        // The client's own `fetch` — see the equivalent assertion in
        // buy-kontor.more.test.ts for why bypassing it would block the listing.
        fetch: ctxFetch,
        assetKind: "token",
        korAmount: "100",
        contractAddress: null,
      }),
    );
  });

  it("passes an NFT listing's id and contract through", async () => {
    mockCreateSwap.mockResolvedValue({ swap: { id: "s1" }, created: true });

    await openKontorSellOrder(nftParams, http, makeSigner({ p2tr: P2TR }), ctx);

    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        assetKind: "nft",
        nftId: "nft-1",
        contractAddress: "nft@0.0",
        korAmount: null,
      }),
    );
  });

  it("aborts before reserving the listing fee when the seller has no KOR", async () => {
    const close = vi.fn();
    mockMakeSession.mockReturnValue({ close });
    mockPreflight.mockResolvedValue(
      verdict(new Error("Not enough KOR to pay Kontor network gas")),
    );

    const events: Array<{ step: string; phase: string }> = [];
    await expect(
      openKontorSellOrder(tokenParams, http, makeSigner({ p2tr: P2TR }), ctx, {
        onProgress: (e) => events.push(e),
      }),
    ).rejects.toThrow(/Not enough KOR/);

    // No fee quote reserved, no credit burned, no attach reveal broadcast.
    expect(mockFeeQuote).not.toHaveBeenCalled();
    expect(mockBindToken).not.toHaveBeenCalled();
    expect(mockCreateSwap).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(
      events.some((e) => e.step === "preflightKontor" && e.phase === "error"),
    ).toBe(true);
  });

  it("aborts when the wallet does not hold the asset being listed", async () => {
    mockPreflight.mockResolvedValue(
      verdict(
        new Error("Cannot list this Kontor asset: not held by the connected wallet"),
      ),
    );

    await expect(
      openKontorSellOrder(tokenParams, http, makeSigner({ p2tr: P2TR }), ctx),
    ).rejects.toThrow(/not held by the connected wallet/);
    expect(mockFeeQuote).not.toHaveBeenCalled();
    expect(mockCreateSwap).not.toHaveBeenCalled();
  });

  it("propagates a failure to *check* — an unreadable indexer is not a verdict", async () => {
    const close = vi.fn();
    mockMakeSession.mockReturnValue({ close });
    mockPreflight.mockRejectedValue(new Error("Kontor signer lookup failed"));

    await expect(
      openKontorSellOrder(tokenParams, http, makeSigner({ p2tr: P2TR }), ctx),
    ).rejects.toThrow(/signer lookup failed/);
    expect(mockFeeQuote).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

describe("openKontorSellOrder parameter validation", () => {
  it("throws when priceSats is not positive", async () => {
    await expect(
      openKontorSellOrder(
        { ...tokenParams, priceSats: 0 } as unknown as KontorSellParams,
        http,
        makeSigner({ p2tr: P2TR }),
        ctx,
      ),
    ).rejects.toThrow(/positive priceSats/);
  });

  it("throws when a token listing has no korAmount", async () => {
    await expect(
      openKontorSellOrder(
        {
          listingType: "kontor",
          kontorAssetKind: "token",
          korAmount: "",
          priceSats: 50000,
        } as unknown as KontorSellParams,
        http,
        makeSigner({ p2tr: P2TR }),
        ctx,
      ),
    ).rejects.toThrow(/require korAmount/);
  });

  it("throws when an NFT listing has no nftId", async () => {
    await expect(
      openKontorSellOrder(
        {
          listingType: "kontor",
          kontorAssetKind: "nft",
          nftId: "",
          nftContractAddress: "nft@1.2",
          priceSats: 50000,
        } as unknown as KontorSellParams,
        http,
        makeSigner({ p2tr: P2TR }),
        ctx,
      ),
    ).rejects.toThrow(/require nftId/);
  });

  it("throws when an NFT listing has no contract address", async () => {
    await expect(
      openKontorSellOrder(
        {
          listingType: "kontor",
          kontorAssetKind: "nft",
          nftId: "n1",
          nftContractAddress: "",
          priceSats: 50000,
        } as unknown as KontorSellParams,
        http,
        makeSigner({ p2tr: P2TR }),
        ctx,
      ),
    ).rejects.toThrow(/require nftContractAddress/);
  });

  it("throws when the asset kind is unrecognized", async () => {
    await expect(
      openKontorSellOrder(
        {
          listingType: "kontor",
          kontorAssetKind: "bogus",
          priceSats: 50000,
        } as unknown as KontorSellParams,
        http,
        makeSigner({ p2tr: P2TR }),
        ctx,
      ),
    ).rejects.toThrow(/kontorAssetKind/);
  });

  it("throws when the signer has no P2TR address", async () => {
    await expect(
      openKontorSellOrder(tokenParams, http, makeSigner(), ctx),
    ).rejects.toThrow(/P2TR address/);
  });
});

describe("openKontorSellOrder listing failure", () => {
  it("wraps a failed listing POST in KontorListingNotRecordedError carrying the blob and create request", async () => {
    const session = { close: vi.fn() };
    mockMakeSession.mockReturnValue(session);
    const cause = new Error("createSwap 500");
    mockCreateSwap.mockRejectedValue(cause);

    const err = await openKontorSellOrder(
      tokenParams,
      http,
      makeSigner({ p2tr: P2TR }),
      ctx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(KontorListingNotRecordedError);
    expect(err.offerBlob).toBe("OFFERBLOB");
    expect(err.createRequest.kontorOfferBlob).toBe("OFFERBLOB");
    expect(err.createRequest.assetUtxoId).toBe(`${ESCROW_TXID}:0`);
    expect(err.cause).toBe(cause);
    expect(session.close).toHaveBeenCalled();
  });
});

describe("openKontorSellOrder happy path", () => {
  it("returns the created swap and the asset transaction", async () => {
    mockCreateSwap.mockResolvedValue({
      swap: { id: "swap1" },
      created: true,
      status: 201,
    });

    const result = await openKontorSellOrder(
      tokenParams,
      http,
      makeSigner({ p2tr: P2TR }),
      ctx,
    );

    expect(result.created).toBe(true);
    expect(result.swap.id).toBe("swap1");
    expect(result.transactions).toEqual([{ txid: ESCROW_TXID, kind: "asset" }]);
  });
});
