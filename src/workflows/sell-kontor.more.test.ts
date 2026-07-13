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

import {
  openKontorSellOrder,
  KontorListingNotRecordedError,
} from "./sell-kontor.js";

const P2TR = "tb1pseller";
const ESCROW_TXID = "aa".repeat(32);
const ctx = {
  chain: "signet",
  indexerUrl: "https://ix",
  btcNetwork: {},
} as unknown as KontorContext;
const http = {} as unknown as HttpClient;

const tokenParams = {
  listingType: "kontor",
  kontorAssetKind: "token",
  korAmount: "100",
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
