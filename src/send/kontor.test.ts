import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SendDeps } from "./types.js";

/**
 * Unit tests for the Kontor send composers (`prepareKontorToken`,
 * `sendKontorToken`, `prepareKontorNft`, `sendKontorNft`). Every Kontor
 * collaborator — session, funding, signing, contract bindings, holder decode,
 * and the SDK's `HolderRef` — is mocked, so these tests exercise the composer's
 * own orchestration and guards (ctx/amount/nftId/contractAddress/recipient/p2tr)
 * in isolation, with no WASM, network, or real key material involved.
 */

const h = vi.hoisted(() => {
  const holderRefValue = { __holder: true };
  const sessionClose = vi.fn();
  const submitToken = vi.fn(async () => ({ txid: "token-txid" }));
  const transferToken = vi.fn(() => ({ submit: submitToken }));
  const bindKontorToken = vi.fn(() => ({ transfer: transferToken }));
  const submitNft = vi.fn(async () => ({ txid: "nft-txid" }));
  const transferNft = vi.fn(() => ({ submit: submitNft }));
  const bindKontorNft = vi.fn(() => ({ transfer: transferNft }));
  return {
    holderRefValue,
    sessionClose,
    makeKontorSession: vi.fn(() => ({ close: sessionClose })),
    resolveKontorFunding: vi.fn(() => ({ kind: "funding" })),
    getKontorSigning: vi.fn(async () => ({
      identity: { address: "tb1pidentity" },
    })),
    submitToken,
    transferToken,
    bindKontorToken,
    submitNft,
    transferNft,
    bindKontorNft,
    Decimal: { from: vi.fn((v: string) => ({ __decimal: v })) },
    xOnlyFromTaprootAddress: vi.fn((_addr: string) => "ab".repeat(32)),
    HolderRef: { xOnlyPubkey: vi.fn(() => holderRefValue) },
  };
});

vi.mock("../kontor/session.js", () => ({ makeKontorSession: h.makeKontorSession }));
vi.mock("../kontor/funding.js", () => ({
  resolveKontorFunding: h.resolveKontorFunding,
}));
vi.mock("../kontor/signing.js", () => ({ getKontorSigning: h.getKontorSigning }));
vi.mock("../kontor/contracts.js", () => ({
  bindKontorToken: h.bindKontorToken,
  bindKontorNft: h.bindKontorNft,
  Decimal: h.Decimal,
}));
vi.mock("../kontor/holders.js", () => ({
  xOnlyFromTaprootAddress: h.xOnlyFromTaprootAddress,
}));
vi.mock("@kontor/sdk", () => ({ HolderRef: h.HolderRef }));

import {
  prepareKontorToken,
  sendKontorToken,
  prepareKontorNft,
  sendKontorNft,
} from "./kontor.js";
import { makeSigner } from "../test-utils.js";

const TAPROOT = "tb1ptaproot";
const RECIPIENT = "tb1precipient";
const INDEXER = "https://indexer.example";
const chain = { name: "signet" };
const btcNetwork = { name: "testnet-network" };
const http = { request: vi.fn() };

function baseDeps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    signer: makeSigner({ p2tr: TAPROOT }),
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    network: "testnet",
    btcNetwork: btcNetwork as unknown as SendDeps["btcNetwork"],
    kontorNetwork: "signet",
    http: http as unknown as SendDeps["http"],
    kontorCtx: {
      chain: chain as unknown as NonNullable<SendDeps["kontorCtx"]>["chain"],
      indexerUrl: INDEXER,
      btcNetwork: btcNetwork as unknown as SendDeps["btcNetwork"],
    },
    ...overrides,
  } as SendDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish default implementations cleared of call history above.
  h.makeKontorSession.mockReturnValue({ close: h.sessionClose });
  h.resolveKontorFunding.mockReturnValue({ kind: "funding" });
  h.getKontorSigning.mockResolvedValue({ identity: { address: "tb1pidentity" } });
  h.submitToken.mockResolvedValue({ txid: "token-txid" });
  h.transferToken.mockReturnValue({ submit: h.submitToken });
  h.bindKontorToken.mockReturnValue({ transfer: h.transferToken });
  h.submitNft.mockResolvedValue({ txid: "nft-txid" });
  h.transferNft.mockReturnValue({ submit: h.submitNft });
  h.bindKontorNft.mockReturnValue({ transfer: h.transferNft });
  h.Decimal.from.mockImplementation((v: string) => ({ __decimal: v }));
  h.xOnlyFromTaprootAddress.mockReturnValue("ab".repeat(32));
  h.HolderRef.xOnlyPubkey.mockReturnValue(h.holderRefValue);
});

describe("sendKontorToken", () => {
  it("composes, submits and returns the txid, closing the session", async () => {
    const deps = baseDeps();
    const result = await sendKontorToken(
      { toAddress: RECIPIENT, amount: "100.5", satsPerVbyte: 3 },
      deps,
    );

    expect(result).toEqual({ txid: "token-txid" });

    // Recipient holder derived from the P2TR address, then wrapped in a HolderRef.
    expect(h.xOnlyFromTaprootAddress).toHaveBeenCalledWith(RECIPIENT);
    expect(h.HolderRef.xOnlyPubkey).toHaveBeenCalledWith("ab".repeat(32));

    // Signing derived from the signer against the ctx chain (key stays local).
    expect(h.getKontorSigning).toHaveBeenCalledWith(deps.signer, chain);

    // Funding resolved for the signer's OWN taproot address (public), no key.
    expect(h.resolveKontorFunding).toHaveBeenCalledWith(
      http,
      TAPROOT,
      btcNetwork,
      undefined,
    );

    // Session built with the ctx chain / indexer and the requested fee rate.
    expect(h.makeKontorSession).toHaveBeenCalledWith(
      expect.objectContaining({
        chain,
        indexerUrl: INDEXER,
        feeRate: 3,
        funding: { kind: "funding" },
        signing: { identity: { address: "tb1pidentity" } },
      }),
    );

    // Transfer targets the derived holder for the scaled Decimal amount.
    expect(h.bindKontorToken).toHaveBeenCalledWith({ close: h.sessionClose });
    expect(h.Decimal.from).toHaveBeenCalledWith("100.5");
    expect(h.transferToken).toHaveBeenCalledWith(h.holderRefValue, {
      __decimal: "100.5",
    });
    expect(h.sessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session even when submit rejects", async () => {
    h.submitToken.mockRejectedValueOnce(new Error("submit blew up"));
    await expect(
      sendKontorToken({ toAddress: RECIPIENT, amount: "5" }, baseDeps()),
    ).rejects.toThrow(/submit blew up/);
    expect(h.sessionClose).toHaveBeenCalledTimes(1);
  });

  it("throws when the Kontor context is missing", async () => {
    await expect(
      sendKontorToken(
        { toAddress: RECIPIENT, amount: "5" },
        baseDeps({ kontorCtx: undefined }),
      ),
    ).rejects.toThrow(/signet/);
  });

  it("throws when the amount is missing", async () => {
    await expect(
      sendKontorToken({ toAddress: RECIPIENT, amount: "" }, baseDeps()),
    ).rejects.toThrow(/KOR amount is required/);
  });

  it("throws when the recipient is not a taproot address", async () => {
    h.xOnlyFromTaprootAddress.mockReturnValueOnce(null as unknown as string);
    await expect(
      sendKontorToken({ toAddress: "bc1qnope", amount: "5" }, baseDeps()),
    ).rejects.toThrow(/taproot \(P2TR\) address/);
  });

  it("throws when the signer has no P2TR address", async () => {
    await expect(
      sendKontorToken(
        { toAddress: RECIPIENT, amount: "5" },
        baseDeps({ signer: makeSigner({ p2tr: undefined }) }),
      ),
    ).rejects.toThrow(/P2TR address on the signer/);
  });
});

describe("prepareKontorToken", () => {
  it("returns a kor PreparedSend whose broadcast submits the transfer", async () => {
    const prepared = prepareKontorToken(
      { toAddress: RECIPIENT, amount: "42" },
      baseDeps(),
    );
    expect(prepared.kind).toBe("kor");
    expect(prepared.feeSats).toBeNull();
    // Nothing composed until broadcast.
    expect(h.bindKontorToken).not.toHaveBeenCalled();

    await expect(prepared.broadcast()).resolves.toEqual({ txid: "token-txid" });
    expect(h.bindKontorToken).toHaveBeenCalledTimes(1);
  });
});

describe("sendKontorNft", () => {
  const params = {
    contractAddress: "nft@307992.5",
    nftId: "nft-7",
    toAddress: RECIPIENT,
    satsPerVbyte: 2,
  };

  it("composes, submits and returns the txid, closing the session", async () => {
    const deps = baseDeps();
    const result = await sendKontorNft(params, deps);

    expect(result).toEqual({ txid: "nft-txid" });
    expect(h.xOnlyFromTaprootAddress).toHaveBeenCalledWith(RECIPIENT);
    expect(h.getKontorSigning).toHaveBeenCalledWith(deps.signer, chain);
    expect(h.resolveKontorFunding).toHaveBeenCalledWith(
      http,
      TAPROOT,
      btcNetwork,
      undefined,
    );
    expect(h.makeKontorSession).toHaveBeenCalledWith(
      expect.objectContaining({ indexerUrl: INDEXER, feeRate: 2 }),
    );
    // NFT contract bound at its address; transfer targets (nftId, holder).
    expect(h.bindKontorNft).toHaveBeenCalledWith(
      { close: h.sessionClose },
      "nft@307992.5",
    );
    expect(h.transferNft).toHaveBeenCalledWith("nft-7", h.holderRefValue);
    expect(h.sessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session even when submit rejects", async () => {
    h.submitNft.mockRejectedValueOnce(new Error("nft submit failed"));
    await expect(sendKontorNft(params, baseDeps())).rejects.toThrow(
      /nft submit failed/,
    );
    expect(h.sessionClose).toHaveBeenCalledTimes(1);
  });

  it("throws when the Kontor context is missing", async () => {
    await expect(
      sendKontorNft(params, baseDeps({ kontorCtx: undefined })),
    ).rejects.toThrow(/signet/);
  });

  it("throws when the nftId is missing", async () => {
    await expect(
      sendKontorNft({ ...params, nftId: "" }, baseDeps()),
    ).rejects.toThrow(/nftId is required/);
  });

  it("throws when the contractAddress is missing", async () => {
    await expect(
      sendKontorNft({ ...params, contractAddress: "" }, baseDeps()),
    ).rejects.toThrow(/contractAddress is required/);
  });

  it("throws when the recipient is not a taproot address", async () => {
    h.xOnlyFromTaprootAddress.mockReturnValueOnce(null as unknown as string);
    await expect(
      sendKontorNft({ ...params, toAddress: "bc1qnope" }, baseDeps()),
    ).rejects.toThrow(/taproot \(P2TR\) address/);
  });

  it("throws when the signer has no P2TR address", async () => {
    await expect(
      sendKontorNft(params, baseDeps({ signer: makeSigner({ p2tr: undefined }) })),
    ).rejects.toThrow(/P2TR address on the signer/);
  });
});

describe("prepareKontorNft", () => {
  it("returns a kontor-nft PreparedSend whose broadcast submits the transfer", async () => {
    const prepared = prepareKontorNft(
      {
        contractAddress: "nft@307992.5",
        nftId: "nft-7",
        toAddress: RECIPIENT,
      },
      baseDeps(),
    );
    expect(prepared.kind).toBe("kontor-nft");
    expect(prepared.feeSats).toBeNull();
    expect(h.bindKontorNft).not.toHaveBeenCalled();

    await expect(prepared.broadcast()).resolves.toEqual({ txid: "nft-txid" });
    expect(h.bindKontorNft).toHaveBeenCalledTimes(1);
  });
});
