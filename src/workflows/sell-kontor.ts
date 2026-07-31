import type { KontorSession } from "@kontor/sdk";
import type { HttpClient } from "../api/http.js";
import type { Signer } from "../crypto/signer.js";
import {
  createKontorFeeQuote,
  createKontorSwap,
  type KontorCreateSwapRequest,
} from "../api/kontor.js";
import { resolveKontorFunding } from "../kontor/funding.js";
import { makeKontorSession } from "../kontor/session.js";
import {
  bindKontorNft,
  bindKontorToken,
  attachRevealEscrowFromBlob,
  Decimal,
} from "../kontor/contracts.js";
import { preflightKontorListing } from "../kontor/preflight.js";
import { kontorNativeTokenAddress } from "../kontor/chain.js";
import { getKontorSigning } from "../kontor/signing.js";
import type { KontorContext } from "../kontor/context.js";
import type {
  AtomicSwap,
  KontorFunding,
  WorkflowOptions,
} from "../types/index.js";
import { WorkflowProgressReporter } from "./progress.js";
import type { SellBroadcastTx } from "./sell.js";

interface KontorSellBaseParams {
  listingType: "kontor";
  /** Net sats the seller receives. */
  priceSats: number;
  /** Optional sat/vByte fee rate for the on-chain attach reveal. */
  satsPerVbyte?: number;
  /**
   * Funding UTXOs for the attach reveal. A static list, a fetcher, or omitted to
   * auto-fetch the seller's confirmed taproot UTXOs from Horizon.
   */
  fundingUtxos?: KontorFunding;
}

/** Sell a KOR token amount. */
export interface KontorTokenSellParams extends KontorSellBaseParams {
  kontorAssetKind: "token";
  /** KOR amount as a decimal string (e.g. "100.5"). */
  korAmount: string;
}

/** Sell a Kontor NFT. */
export interface KontorNftSellParams extends KontorSellBaseParams {
  kontorAssetKind: "nft";
  nftId: string;
  /** NFT contract address (`name@height.txIndex`). */
  nftContractAddress: string;
}

export type KontorSellParams = KontorTokenSellParams | KontorNftSellParams;

/**
 * Thrown when the Kontor attach reveal is already on-chain (asset escrowed) but
 * the listing POST to Horizon failed. The asset is NOT lost — retry the POST with
 * `createRequest` (no re-broadcast), or reclaim the escrow by revoking the offer.
 */
export class KontorListingNotRecordedError extends Error {
  readonly offerBlob: string;
  readonly createRequest: KontorCreateSwapRequest;
  override readonly cause?: unknown;

  constructor(
    offerBlob: string,
    createRequest: KontorCreateSwapRequest,
    cause: unknown,
  ) {
    super(
      "Kontor asset was escrowed on-chain but the listing could not be recorded. " +
        "Retry with the provided createRequest, or revoke the offer to reclaim the asset.",
    );
    this.name = "KontorListingNotRecordedError";
    this.offerBlob = offerBlob;
    this.createRequest = createRequest;
    this.cause = cause;
  }
}

function validateKontorSellParams(params: KontorSellParams): void {
  if (!Number.isFinite(params.priceSats) || params.priceSats <= 0) {
    throw new Error("Kontor listings require a positive priceSats");
  }
  if (params.kontorAssetKind === "token") {
    if (!params.korAmount) {
      throw new Error("Kontor token listings require korAmount (decimal string)");
    }
  } else if (params.kontorAssetKind === "nft") {
    if (!params.nftId) throw new Error("Kontor NFT listings require nftId");
    if (!params.nftContractAddress) {
      throw new Error("Kontor NFT listings require nftContractAddress");
    }
  } else {
    throw new Error('Kontor listings require kontorAssetKind: "token" | "nft"');
  }
}

/**
 * openKontorSellOrder — preflight → reserve fee → escrow + compose offer
 * (client-side SDK) → record listing.
 *
 * The Kontor SDK composes, signs, and broadcasts the attach reveal in one call;
 * the private key never leaves the client. Only the signed offer blob and
 * bookkeeping fields are sent to Horizon.
 *
 * The preflight step is not optional politeness: the attach reveal's `attach`
 * op is gas-metered and self-paid by the seller, and a payer who cannot cover
 * the gas has their op dropped *silently* (no result row, no error anywhere on
 * chain) while the Bitcoin transaction still confirms and still pays the
 * listing fee. That produces a live listing whose asset was never escrowed.
 * See `kontor/preflight.ts`.
 */
export async function openKontorSellOrder(
  params: KontorSellParams,
  http: HttpClient,
  signer: Signer,
  ctx: KontorContext,
  options?: WorkflowOptions,
): Promise<{
  swap: AtomicSwap;
  created: boolean;
  transactions: SellBroadcastTx[];
}> {
  const progress = new WorkflowProgressReporter(
    "openSellOrder",
    options?.onProgress,
    5,
  );

  const sellerAddress = progress.runSync("validateParams", () => {
    validateKontorSellParams(params);
    const addresses = signer.getAddresses();
    if (!addresses.p2tr) {
      throw new Error(
        "Kontor listings require a P2TR address. Use a LocalSigner (privateKey) " +
          "with a testnet/signet network so a taproot address is derived.",
      );
    }
    return addresses.p2tr;
  });

  // Build the session first and gate on chain state: the wallet must be able to
  // pay the attach's gas, and must actually hold what it is listing. Both are
  // `view` calls — no signature, no transaction, nothing spent — and they run
  // before the fee quote so a blocked listing never reserves a fee or burns a
  // listing credit.
  const session = await progress.runAsync("preflightKontor", async () => {
    const signing = await getKontorSigning(signer, ctx.chain);
    const funding = resolveKontorFunding(
      http,
      sellerAddress,
      ctx.btcNetwork,
      params.fundingUtxos,
    );
    const built = makeKontorSession({
      chain: ctx.chain,
      signing,
      funding,
      indexerUrl: ctx.indexerUrl,
      feeRate: params.satsPerVbyte,
    });
    try {
      // The same call `client.preflightKontorListing()` exposes — one gate, so
      // what a review screen reported and what the broadcast enforces cannot
      // drift apart.
      const verdict = await preflightKontorListing({
        session: built,
        indexerUrl: ctx.indexerUrl,
        fetch: ctx.fetch,
        assetKind: params.kontorAssetKind,
        nftId: params.kontorAssetKind === "nft" ? params.nftId : null,
        contractAddress:
          params.kontorAssetKind === "nft" ? params.nftContractAddress : null,
        korAmount: params.kontorAssetKind === "token" ? params.korAmount : null,
      });
      if (verdict.error) throw verdict.error;
    } catch (err) {
      built.close();
      throw err;
    }
    return built;
  });

  try {
    return await escrowAndRecord(
      params,
      http,
      ctx,
      progress,
      session,
      sellerAddress,
    );
  } finally {
    session.close();
  }
}

/**
 * The half of `openKontorSellOrder` that runs once the preflight has cleared:
 * reserve the listing fee, broadcast the attach reveal + compose the offer, and
 * record the listing. Split out so the session's lifetime is a single
 * `try/finally` in the caller.
 */
async function escrowAndRecord(
  params: KontorSellParams,
  http: HttpClient,
  ctx: KontorContext,
  progress: WorkflowProgressReporter<"openSellOrder">,
  session: KontorSession,
  sellerAddress: string,
): Promise<{
  swap: AtomicSwap;
  created: boolean;
  transactions: SellBroadcastTx[];
}> {
  const feeQuote = await progress.runAsync("reserveKontorFee", () =>
    createKontorFeeQuote(http, sellerAddress),
  );
  // When the account covers the fee with a credit / subscription the server
  // waives it (feeWaived, no payment address): drop the fee output and let the
  // listing POST decrement a credit instead. Otherwise the platform fee rides
  // the attach reveal as an extra output.
  const extraOutputs =
    feeQuote.feeWaived || feeQuote.paymentAddress == null
      ? []
      : [
          {
            pay: {
              address: feeQuote.paymentAddress,
              value: BigInt(feeQuote.paymentAmount),
            },
          },
        ];

  const { offerBlob, assetUtxoId, assetUtxoValue, contractAddress } =
    await progress.runAsync("composeKontorOffer", async () => {
      let blob: string;
      let resolvedContractAddress: string;

      const offerOpts = extraOutputs.length
        ? { price: BigInt(params.priceSats), extraOutputs }
        : { price: BigInt(params.priceSats) };

      if (params.kontorAssetKind === "nft") {
        resolvedContractAddress = params.nftContractAddress;
        const offer = await bindKontorNft(session, resolvedContractAddress)
          .attachment(params.nftId)
          .offer(offerOpts);
        blob = offer.serialize();
      } else {
        resolvedContractAddress = kontorNativeTokenAddress(ctx.chain);
        const offer = await bindKontorToken(session)
          .attachment(Decimal.from(params.korAmount))
          .offer(offerOpts);
        blob = offer.serialize();
      }

      const escrow = attachRevealEscrowFromBlob(blob);
      return {
        offerBlob: blob,
        assetUtxoId: `${escrow.txid}:0`,
        assetUtxoValue: escrow.value,
        contractAddress: resolvedContractAddress,
      };
    });

  // The attach reveal is on-chain now. Capture the full create request so a failed
  // POST can be retried without re-broadcasting (orphan protection).
  const createRequest: KontorCreateSwapRequest = {
    assetUtxoId,
    assetUtxoValue,
    price: params.priceSats,
    sellerAddress,
    kontorOfferBlob: offerBlob,
    kontorAssetKind: params.kontorAssetKind,
    kontorContractAddress: contractAddress,
    kontorNftId: params.kontorAssetKind === "nft" ? params.nftId : null,
    kontorAmount: params.kontorAssetKind === "token" ? params.korAmount : null,
    // Omitted on the credit path (no fee_payment) so the listing POST takes the
    // server's session-credit branch instead of expecting an on-chain payment.
    feePaymentId: feeQuote.feePaymentId ?? undefined,
  };

  let result;
  try {
    result = await progress.runAsync("createSwap", () =>
      createKontorSwap(http, createRequest),
    );
  } catch (cause) {
    throw new KontorListingNotRecordedError(offerBlob, createRequest, cause);
  }

  // The Kontor attach reveal is always broadcast on-chain (assetUtxoId is its
  // escrow txid); the platform fee, when charged, rides inside it as an extra
  // output, so there is never a standalone fee tx.
  const transactions: SellBroadcastTx[] = [];
  const assetTxId = assetUtxoId.split(":")[0];
  if (assetTxId) transactions.push({ txid: assetTxId, kind: "asset" });
  return { swap: result.swap, created: result.created, transactions };
}
