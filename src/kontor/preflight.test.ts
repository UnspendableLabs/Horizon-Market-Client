import { describe, it, expect, afterEach, vi } from "vitest";
import { HolderRef, Identity, KontorSession, signet } from "@kontor/sdk";
import type { KontorTransport } from "@kontor/sdk";
import { Decimal } from "./contracts.js";
import {
  assertKontorAssetAvailable,
  assertKontorEscrowHoldsAsset,
  assertKontorGasBalance,
  describeHolder,
  holderRefEquals,
  isKontorPreflightRefusal,
  preflightKontorDelist,
  preflightKontorListing,
  preflightKontorPurchase,
  korCostForGas,
  readKontorGasBalance,
  KontorAssetUnavailableError,
  KontorEscrowNotFundedError,
  KontorInsufficientGasError,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_ATTACH_GAS_LIMIT,
  KONTOR_DETACH_GAS_LIMIT,
} from "./preflight.js";

/**
 * Pre-flight gating for Kontor listings/purchases. The failure these guard
 * against is silent on chain (an unpayable op is dropped before execution and
 * leaves no result row), so the tests pin both directions: a funded wallet must
 * pass, and an unfunded one must fail *before* anything is broadcast — with an
 * error that names KOR.
 */

const SELLER_XONLY =
  "ae7ab6a12fef7bfffea8adab180e4daf47284ce4d7d960cc34a4dbbe02b9ad4d";
const INDEXER = "https://indexer.example/api";
const ESCROW_TXID = "a".repeat(64);
const ESCROW = `${ESCROW_TXID}:0`;

/** WAVE encoding of `option<decimal>`, as the indexer emits it. */
function waveDecimal(value: string | null): string {
  if (value === null) return "none";
  const raw = Decimal.from(value).toRaw();
  return `some({r0: ${raw.r0}, r1: ${raw.r1}, r2: ${raw.r2}, r3: ${raw.r3}, sign: ${raw.sign}})`;
}

/** WAVE encoding of `option<nft-info>`. */
function waveNftInfo(nftId: string, owner: string): string {
  return `some({nft-id: "${nftId}", owner: ${owner}, creator: signer-id(16), agreement-id: "file_x"})`;
}

/** Idle poller fetch — the session's results poller must not hit the network. */
const pollerFetch = (async (url: string) => {
  const body = String(url).includes("/results")
    ? {
        results: [],
        pagination: { has_more: false, next_offset: null, total_count: 0 },
      }
    : { last_result_id: 0, recent_blocks: [], signature: "idle" };
  return new Response(JSON.stringify({ result: body }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const openSessions: KontorSession[] = [];
afterEach(() => {
  for (const session of openSessions) session.close();
  openSessions.length = 0;
});

/** Every `view` expression the last `stubSession` was asked for, in order. */
let views: string[] = [];

/**
 * Read-only session whose `view` is answered by `respond(wave)`. Every other
 * transport method throws — pre-flight must never compose, sign or broadcast.
 */
function stubSession(respond: (wave: string) => string): KontorSession {
  const fail = () => Promise.reject(new Error("preflight must not broadcast"));
  views = [];
  const transport = {
    view: (_contract: unknown, wave: string) => {
      views.push(wave);
      return Promise.resolve(respond(wave));
    },
    signer: fail,
    signerFootprint: fail,
    provenance: fail,
    inspect: fail,
    simulate: fail,
    submit: fail,
    compose: fail,
    composeReveal: fail,
    composeAndSign: fail,
    submitReveal: fail,
    broadcast: fail,
  } as unknown as KontorTransport;

  const session = new KontorSession({
    chain: signet,
    identity: Identity.fromXOnly(SELLER_XONLY, signet),
    fetch: pollerFetch,
    transport: () => transport,
  });
  openSessions.push(session);
  return session;
}

/** `fetch` stub for the indexer's `/signers/{key}` lookup. */
function signerLookup(
  outcome: { signerId: number } | "unregistered" | { httpStatus: number },
): typeof globalThis.fetch {
  return vi.fn(async () => {
    if (outcome === "unregistered") return new Response("", { status: 404 });
    if ("httpStatus" in outcome) {
      return new Response("boom", { status: outcome.httpStatus });
    }
    return new Response(
      JSON.stringify({ result: { signer_id: outcome.signerId } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
}

describe("readKontorGasBalance", () => {
  it("reads the registered signer-id holder", async () => {
    const session = stubSession(() => waveDecimal("1.25"));
    const result = await readKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
    });
    expect(result.signerId).toBe(16);
    expect(result.balanceKor).toBe("1.25");
  });

  it("reports zero for a wallet that never registered a signer", async () => {
    const session = stubSession(() => waveDecimal(null));
    const result = await readKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup("unregistered"),
    });
    expect(result.signerId).toBeNull();
    expect(result.balanceKor).toBe("0");
  });

  it("answers an unregistered wallet without a chain read", async () => {
    // Not an optimisation: a holder-ref view for an unknown x-only key is a
    // deterministic *error* in the node ("signer not found … view context"),
    // so asking would turn "brand-new wallet, no KOR" — the commonest way to
    // hit this gate — into a cryptic failure instead of a gas error.
    const session = stubSession(() => {
      throw new Error("signer not found for x-only-pubkey (view context)");
    });
    await expect(
      readKontorGasBalance({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup("unregistered"),
      }),
    ).resolves.toEqual({ signerId: null, balanceKor: "0" });
    expect(views).toEqual([]);
  });

  it("reads the payer's holder only, never the tweaked taproot key", async () => {
    // The tweaked output key in the bech32m address is a *different* Kontor
    // identity with its own signer-id. Counting its KOR would let a wallet
    // clear the gate on tokens the node cannot draw this op's gas from —
    // exactly the silent drop the gate exists to prevent.
    const session = stubSession(() => waveDecimal("1.25"));
    await readKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toContain("signer-id(16)");
  });
});

describe("assertKontorGasBalance", () => {
  it("passes when the wallet covers the gas limit", async () => {
    const session = stubSession(() => waveDecimal("0.01"));
    await expect(
      assertKontorGasBalance({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 16 }),
        gasLimit: KONTOR_ATTACH_GAS_LIMIT,
        operation: "listing",
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks a listing when the seller holds no KOR, naming KOR and the cost", async () => {
    const session = stubSession(() => waveDecimal(null));
    const error = await assertKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup("unregistered"),
      gasLimit: KONTOR_ATTACH_GAS_LIMIT,
      operation: "listing",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorInsufficientGasError);
    const gasError = error as KontorInsufficientGasError;
    expect(gasError.operation).toBe("listing");
    expect(gasError.requiredKor).toBe("0.0001");
    expect(gasError.availableKor).toBe("0");
    expect(gasError.signerId).toBeNull();
    expect(gasError.message).toMatch(/KOR/);
    expect(gasError.message).toMatch(/nothing was broadcast or paid/i);
  });

  it("blocks a purchase when the buyer is short of the sponsor's gas", async () => {
    const session = stubSession(() => waveDecimal("0.00001"));
    const error = await assertKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 12 }),
      gasLimit: KONTOR_ACCEPT_GAS_LIMIT,
      operation: "purchase",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorInsufficientGasError);
    expect((error as KontorInsufficientGasError).operation).toBe("purchase");
    expect((error as KontorInsufficientGasError).availableKor).toBe("0.00001");
  });

  it("names the delist flow, whose failure mode is the unrecoverable one", async () => {
    const session = stubSession(() => waveDecimal("0"));
    const error = await assertKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 12 }),
      gasLimit: KONTOR_DETACH_GAS_LIMIT,
      operation: "delist",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorInsufficientGasError);
    expect((error as Error).message).toMatch(/Delisting a Kontor listing/);
    expect((error as KontorInsufficientGasError).requiredKor).toBe("0.0001");
  });

  it("surfaces an indexer failure as an error, not as 'no KOR'", async () => {
    const session = stubSession(() => waveDecimal("10"));
    const error = await assertKontorGasBalance({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ httpStatus: 503 }),
      gasLimit: KONTOR_ATTACH_GAS_LIMIT,
      operation: "listing",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(KontorInsufficientGasError);
    expect((error as Error).message).toMatch(/signer lookup failed/i);
  });
});

describe("assertKontorAssetAvailable", () => {
  it("passes when the NFT is held by the connected wallet's signer-id", async () => {
    const session = stubSession(() => waveNftInfo("nft-1", "signer-id(16)"));
    await expect(
      assertKontorAssetAvailable({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 16 }),
        assetKind: "nft",
        nftId: "nft-1",
        contractAddress: "nft@0.0",
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks listing an NFT held by another account", async () => {
    const session = stubSession(() => waveNftInfo("nft-1", "signer-id(99)"));
    const error = await assertKontorAssetAvailable({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorAssetUnavailableError);
    expect((error as Error).message).toMatch(/not held by the connected wallet/);
  });

  it("blocks listing more KOR than the wallet holds", async () => {
    const session = stubSession(() => waveDecimal("3"));
    const error = await assertKontorAssetAvailable({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "token",
      korAmount: "10",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorAssetUnavailableError);
    expect((error as KontorAssetUnavailableError).availableKor).toBe("3");
  });

  it("blocks listing the whole balance: the attach's gas comes out of it too", async () => {
    // The gas hold lands *before* the attach moves the tokens, so listing every
    // last KOR passes both checks taken separately and still fails on chain.
    const session = stubSession(() => waveDecimal("10"));
    const error = await assertKontorAssetAvailable({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "token",
      korAmount: "10",
      reserveKor: korCostForGas(KONTOR_ATTACH_GAS_LIMIT),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorAssetUnavailableError);
    expect((error as Error).message).toMatch(/held for network gas/);
  });

  it("allows a listing that leaves the gas covered", async () => {
    const session = stubSession(() => waveDecimal("10"));
    await expect(
      assertKontorAssetAvailable({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 16 }),
        assetKind: "token",
        korAmount: "9.9999",
        reserveKor: korCostForGas(KONTOR_ATTACH_GAS_LIMIT),
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks a token listing from an unregistered wallet without a chain read", async () => {
    const session = stubSession(() => {
      throw new Error("signer not found for x-only-pubkey (view context)");
    });
    const error = await assertKontorAssetAvailable({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup("unregistered"),
      assetKind: "token",
      korAmount: "1",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorAssetUnavailableError);
    expect((error as KontorAssetUnavailableError).availableKor).toBe("0");
    expect(views).toEqual([]);
  });
});

describe("assertKontorEscrowHoldsAsset", () => {
  it("passes when the NFT is held by the escrow UTXO", async () => {
    const session = stubSession(() =>
      waveNftInfo("nft-1", `utxo({txid: "${ESCROW_TXID}", vout: 0})`),
    );
    await expect(
      assertKontorEscrowHoldsAsset({
        session,
        escrowOutpoint: ESCROW,
        assetKind: "nft",
        nftId: "nft-1",
        contractAddress: "nft@0.0",
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks a purchase when the seller's attach never took effect", async () => {
    // The incident shape: the attach op was dropped, so the NFT is still held
    // by the seller's signer-id while the listing advertises the escrow.
    const session = stubSession(() => waveNftInfo("nft-1", "signer-id(16)"));
    const error = await assertKontorEscrowHoldsAsset({
      session,
      escrowOutpoint: ESCROW,
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorEscrowNotFundedError);
    expect((error as Error).message).toMatch(/not backed on-chain/);
    expect((error as Error).message).toMatch(/Nothing was paid/);
  });

  it("blocks a purchase when the escrow holds less KOR than advertised", async () => {
    const session = stubSession(() => waveDecimal("0.5"));
    const error = await assertKontorEscrowHoldsAsset({
      session,
      escrowOutpoint: ESCROW,
      assetKind: "token",
      korAmount: "2",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KontorEscrowNotFundedError);
  });

  it("rejects a malformed escrow outpoint", async () => {
    const session = stubSession(() => waveDecimal("1"));
    await expect(
      assertKontorEscrowHoldsAsset({
        session,
        escrowOutpoint: "not-an-outpoint",
        assetKind: "token",
        korAmount: "1",
      }),
    ).rejects.toThrow(/Malformed Kontor escrow outpoint/);
  });
});

describe("preflightKontor* (reporting form)", () => {
  /**
   * Same checks as the asserts above, answered instead of thrown — so a review
   * screen can refuse before asking the user to confirm. The contract that
   * matters: a wallet-fixable refusal *resolves* with `ok: false`, a failure to
   * check *throws*. Confusing the two is how "the indexer is down" becomes
   * "you have no KOR".
   */
  it("reports a funded listing as ok, with the numbers a review screen needs", async () => {
    const session = stubSession((wave) =>
      wave.includes("balance")
        ? waveDecimal("1.25")
        : waveNftInfo("nft-1", "signer-id(16)"),
    );
    const result = await preflightKontorListing({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    });

    expect(result).toEqual({
      ok: true,
      error: null,
      balanceKor: "1.25",
      requiredKor: "0.0001",
      gasLimit: KONTOR_ATTACH_GAS_LIMIT,
      signerId: 16,
    });
  });

  it("reports a gas shortfall without throwing, and skips the asset read", async () => {
    // No point asking who owns the asset when the op can't run at all.
    const session = stubSession(() => waveDecimal("0"));
    const result = await preflightKontorListing({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(KontorInsufficientGasError);
    expect(result.balanceKor).toBe("0");
    expect(views).toHaveLength(1); // the gas read only
  });

  it("reports an asset the wallet doesn't hold", async () => {
    const session = stubSession((wave) =>
      wave.includes("balance") ? waveDecimal("5") : waveNftInfo("nft-1", "signer-id(99)"),
    );
    const result = await preflightKontorListing({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(KontorAssetUnavailableError);
    // The gas figures are still filled in — the refusal wasn't about gas.
    expect(result.balanceKor).toBe("5");
  });

  it("holds back the attach's gas from a KOR listing, same as the workflow", async () => {
    const session = stubSession(() => waveDecimal("10"));
    const exact = await preflightKontorListing({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "token",
      korAmount: "10",
    });
    expect(exact.ok).toBe(false);
    expect(exact.error).toBeInstanceOf(KontorAssetUnavailableError);

    const room = await preflightKontorListing({
      session: stubSession(() => waveDecimal("10")),
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      assetKind: "token",
      korAmount: "9.9999",
    });
    expect(room.ok).toBe(true);
  });

  it("throws when the check itself couldn't be made", async () => {
    // An unreachable indexer is not a verdict. Folding it into `ok: false`
    // would tell a solvent user to go fund an account that is already funded.
    const session = stubSession(() => waveDecimal("10"));
    await expect(
      preflightKontorListing({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ httpStatus: 503 }),
        assetKind: "token",
        korAmount: "1",
      }),
    ).rejects.toThrow(/signer lookup failed/);
  });

  it("throws when the asset check fails for a non-verdict reason", async () => {
    // Same rule one layer down: only the three refusals become `ok: false`.
    // A miswired caller (or a view that blew up) must not read as "you don't
    // hold it" — the gas read having succeeded is no reason to answer.
    const session = stubSession(() => waveDecimal("10"));
    await expect(
      preflightKontorListing({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 16 }),
        assetKind: "nft",
        nftId: null,
        contractAddress: "nft@0.0",
      }),
    ).rejects.toThrow(/require nftId and nftContractAddress/);
  });

  it("reports an unbacked listing to the buyer, before they pay", async () => {
    const session = stubSession((wave) =>
      wave.includes("balance")
        ? waveDecimal("1")
        : waveNftInfo("nft-1", "signer-id(16)"),
    );
    const result = await preflightKontorPurchase({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 12 }),
      escrowOutpoint: ESCROW,
      assetKind: "nft",
      nftId: "nft-1",
      contractAddress: "nft@0.0",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(KontorEscrowNotFundedError);
    expect(result.gasLimit).toBe(KONTOR_ACCEPT_GAS_LIMIT);
  });

  it("checks gas only for a listing that recorded no escrow outpoint", async () => {
    const session = stubSession(() => waveDecimal("1"));
    const result = await preflightKontorPurchase({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 12 }),
      escrowOutpoint: null,
      assetKind: null,
    });

    expect(result.ok).toBe(true);
    expect(views).toHaveLength(1);
  });

  it("keeps a listing buyable when it doesn't record which asset it escrows", async () => {
    // `kontorAmount` / `kontorNftId` / `kontorContractAddress` are each nullable
    // on AtomicSwap — a third-party or pre-convention listing may name its
    // escrow but not its contents. That is unverifiable, not unbacked: the
    // escrow half is skipped (as for a missing outpoint) and the gas half still
    // runs. Treating it as a parameter error instead would take a listing that
    // is buyable today and make it unbuyable behind a cryptic throw.
    const funded = () => stubSession(() => waveDecimal("1"));
    const cases = [
      { assetKind: "token" as const, korAmount: null },
      { assetKind: "nft" as const, nftId: null, contractAddress: "nft@0.0" },
      { assetKind: "nft" as const, nftId: "nft-1", contractAddress: null },
    ];

    for (const listing of cases) {
      const result = await preflightKontorPurchase({
        session: funded(),
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 12 }),
        escrowOutpoint: ESCROW,
        ...listing,
      });
      expect(result.ok).toBe(true);
      expect(views).toHaveLength(1); // the gas read only
    }
  });

  it("still refuses a purchase on gas when the escrow can't be verified", async () => {
    // Skipping the escrow half must not weaken the half that can run.
    const result = await preflightKontorPurchase({
      session: stubSession(() => waveDecimal("0")),
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 12 }),
      escrowOutpoint: ESCROW,
      assetKind: "token",
      korAmount: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(KontorInsufficientGasError);
  });

  it("resolves the signer and reads the balance once for a KOR listing", async () => {
    // Pricing the gas already resolved both; the asset half reuses them rather
    // than asking the indexer the same two questions again.
    const lookup = signerLookup({ signerId: 16 });
    const result = await preflightKontorListing({
      session: stubSession(() => waveDecimal("10")),
      indexerUrl: INDEXER,
      fetch: lookup,
      assetKind: "token",
      korAmount: "1",
    });

    expect(result.ok).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(views).toHaveLength(1);
  });

  it("prices a delist from the blob's own detach limit", async () => {
    const session = stubSession(() => waveDecimal("0"));
    const blob = JSON.stringify({
      detachInsts: { ops: [{ gas_limit: 250_000 }] },
    });
    const result = await preflightKontorDelist({
      session,
      indexerUrl: INDEXER,
      fetch: signerLookup({ signerId: 16 }),
      offerBlob: blob,
    });

    expect(result.ok).toBe(false);
    expect(result.gasLimit).toBe(250_000);
    expect(result.requiredKor).toBe("0.00025");
    expect((result.error as KontorInsufficientGasError).operation).toBe("delist");
  });
});

describe("isKontorPreflightRefusal", () => {
  it("separates a wallet-fixable refusal from a failure to check", () => {
    expect(
      isKontorPreflightRefusal(
        new KontorEscrowNotFundedError({
          escrowOutpoint: ESCROW,
          assetKind: "nft",
          asset: "nft-1",
          detail: "empty",
        }),
      ),
    ).toBe(true);
    expect(
      isKontorPreflightRefusal(
        new KontorAssetUnavailableError({
          assetKind: "nft",
          asset: "nft-1",
          detail: "not yours",
        }),
      ),
    ).toBe(true);
    expect(isKontorPreflightRefusal(new Error("indexer down"))).toBe(false);
    expect(isKontorPreflightRefusal("nope")).toBe(false);
  });
});

describe("required-parameter guards", () => {
  // A miswired caller must fail on the parameter, not read the chain and
  // report a plausible-looking "you don't hold it".
  it("rejects an NFT check with no id or contract, on either entry point", async () => {
    const session = stubSession(() => waveDecimal("1"));
    const base = { session, indexerUrl: INDEXER, assetKind: "nft" } as const;
    await expect(
      assertKontorAssetAvailable({
        ...base,
        fetch: signerLookup({ signerId: 16 }),
        nftId: null,
        contractAddress: "nft@0.0",
      }),
    ).rejects.toThrow(/require nftId and nftContractAddress/);
    await expect(
      assertKontorEscrowHoldsAsset({
        session,
        escrowOutpoint: ESCROW,
        assetKind: "nft",
        nftId: "nft-1",
        contractAddress: null,
      }),
    ).rejects.toThrow(/require kontorNftId and kontorContractAddress/);
  });

  it("rejects a token check with no amount, on either entry point", async () => {
    const session = stubSession(() => waveDecimal("1"));
    await expect(
      assertKontorAssetAvailable({
        session,
        indexerUrl: INDEXER,
        fetch: signerLookup({ signerId: 16 }),
        assetKind: "token",
        korAmount: null,
      }),
    ).rejects.toThrow(/require korAmount/);
    await expect(
      assertKontorEscrowHoldsAsset({
        session,
        escrowOutpoint: ESCROW,
        assetKind: "token",
        korAmount: null,
      }),
    ).rejects.toThrow(/require kontorAmount/);
  });
});

describe("describeHolder", () => {
  // These strings are the whole of what a user sees about *who* holds their
  // asset when a listing is refused, so every holder kind must render.
  it("renders every holder kind the contracts can report", () => {
    expect(describeHolder(HolderRef.signerId(42n))).toBe("signer-id(42)");
    expect(describeHolder(HolderRef.xOnlyPubkey(SELLER_XONLY))).toBe(
      `key ${SELLER_XONLY.slice(0, 12)}…`,
    );
    expect(
      describeHolder(HolderRef.utxo({ txid: ESCROW_TXID, vout: 3 })),
    ).toBe(`utxo ${ESCROW_TXID.slice(0, 12)}…:3`);
    expect(describeHolder(HolderRef.core())).toBe("the core identity");
    expect(describeHolder(HolderRef.burner())).toBe("the burner");
  });
});

describe("holderRefEquals", () => {
  it("compares signer-ids, keys (case-insensitively) and utxos", () => {
    expect(
      holderRefEquals(HolderRef.signerId(7n), HolderRef.signerId(7n)),
    ).toBe(true);
    expect(
      holderRefEquals(HolderRef.signerId(7n), HolderRef.signerId(8n)),
    ).toBe(false);
    expect(
      holderRefEquals(
        HolderRef.xOnlyPubkey(SELLER_XONLY.toUpperCase()),
        HolderRef.xOnlyPubkey(SELLER_XONLY),
      ),
    ).toBe(true);
    expect(
      holderRefEquals(
        HolderRef.utxo({ txid: ESCROW_TXID, vout: 0 }),
        HolderRef.utxo({ txid: ESCROW_TXID, vout: 1 }),
      ),
    ).toBe(false);
    expect(
      holderRefEquals(HolderRef.signerId(7n), HolderRef.xOnlyPubkey(SELLER_XONLY)),
    ).toBe(false);
  });
});
