import { HorizonMarketApiError, type HttpClient } from "../api/http.js";
import type { Signer } from "../crypto/signer.js";
import { kontorBuy } from "../api/kontor.js";
import { getPendingPurchaseTxIds } from "../api/atomic-swaps.js";
import { resolveKontorFunding } from "../kontor/funding.js";
import { makeKontorSession } from "../kontor/session.js";
import { getKontorSigning } from "../kontor/signing.js";
import { preflightKontorPurchase } from "../kontor/preflight.js";
import type { KontorContext } from "../kontor/context.js";
import type {
  AtomicSwap,
  KontorFunding,
  PendingSale,
  WorkflowOptions,
} from "../types/index.js";
import { WorkflowProgressReporter } from "./progress.js";

/**
 * The buyer's swap reveal was broadcast on-chain (`accept()`), but recording the
 * purchase with Horizon failed — even after the automatic retries in
 * {@link fillKontorSwap}. The offer is CONSUMED — do not retry `fillSwaps` (it
 * would fail at inspect). Retry only the recording POST with the carried `txId`
 * (`client.recordKontorPurchase`), or wait for the indexer to settle the
 * purchase.
 *
 * The message is written for the end user, because UIs surface it verbatim: by
 * the time this error escapes, the purchase itself is safe on-chain and the only
 * thing left is bookkeeping.
 */
export class KontorPurchaseNotRecordedError extends Error {
  readonly swapId: string;
  /** Txid of the already-broadcast swap reveal. */
  readonly txId: string;
  readonly buyerAddress: string;
  override readonly cause?: unknown;

  constructor(swapId: string, txId: string, buyerAddress: string, cause: unknown) {
    super(
      "Your purchase went through on-chain — the swap is broadcast and the " +
        "asset is yours — but the marketplace could not record it yet. " +
        "Retry re-records the same transaction: nothing is signed, broadcast, " +
        "or paid again.",
    );
    this.name = "KontorPurchaseNotRecordedError";
    this.swapId = swapId;
    this.txId = txId;
    this.buyerAddress = buyerAddress;
    this.cause = cause;
  }
}

/**
 * Backoff before each recording retry, ~30s in total. The server verifies the
 * reveal against its own electrs view of the chain, which lags the Kontor-side
 * broadcast by a few seconds — so the early retries come quickly and the later
 * ones give a slow mempool room to catch up.
 */
const RECORD_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A recording failure worth retrying: the POST never reached the server, the
 * server errored transiently, or its verification could not *find* the
 * just-broadcast reveal (or its commit/funding ancestors) yet. Everything else
 * — already filled, wrong spender, buyer mismatch — is a verdict, not a
 * glitch, and retrying cannot change it.
 */
function isTransientRecordingError(err: unknown): boolean {
  if (!(err instanceof HorizonMarketApiError)) return true;
  if (err.status >= 500 || err.status === 408 || err.status === 429) return true;
  // The kontor-buy route rejects with 400 when its electrs lookup cannot see a
  // transaction yet ("… not found", "missing (tx) hex") — a race, not a verdict.
  return err.status === 400 && /not found|missing (tx )?hex/i.test(err.error);
}

/**
 * True when the purchase is already in the server's pending sales for this
 * buyer — a previous POST landed but its response was lost, so the server now
 * refuses with "already pending" while the recording actually exists. The
 * pending-sales read is the authority the UI polls, so matching `txId` there
 * means recorded.
 */
async function purchaseAlreadyRecorded(
  http: HttpClient,
  swapId: string,
  buyerAddress: string,
  txId: string,
): Promise<boolean> {
  try {
    const txIds = await getPendingPurchaseTxIds(http, swapId, buyerAddress);
    return txIds.includes(txId);
  } catch {
    return false;
  }
}

/**
 * Record the purchase, absorbing transient failures. The reveal is already
 * broadcast when this runs, so giving up early strands a completed purchase in
 * an error dialog — worth ~30s of retries before asking the user to intervene.
 */
async function recordKontorPurchaseWithRetry(
  http: HttpClient,
  swapId: string,
  buyerAddress: string,
  txId: string,
): Promise<PendingSale> {
  let lastFailure: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await kontorBuy(http, swapId, { buyerAddress, txId });
    } catch (failure) {
      lastFailure = failure;
    }
    if (await purchaseAlreadyRecorded(http, swapId, buyerAddress, txId)) {
      return { txId, buyerAddress, atomicSwap: { id: swapId } };
    }
    if (
      attempt >= RECORD_RETRY_DELAYS_MS.length ||
      !isTransientRecordingError(lastFailure)
    ) {
      throw lastFailure;
    }
    await sleep(RECORD_RETRY_DELAYS_MS[attempt]);
  }
}

/**
 * fillKontorSwap — preflight → inspect offer → accept (broadcast swap reveal,
 * client-side SDK) → record.
 *
 * The buyer's commit + swap reveal are composed, signed, and broadcast by the
 * Kontor SDK locally; the private key never leaves the client. Only the buyer
 * address and swap-reveal txid are sent to Horizon.
 *
 * `IncomingOffer.inspect()` is a *structural* check on the offer blob only — it
 * says nothing about chain state. Two chain-state failures are unrecoverable
 * once `accept()` broadcasts, because the swap reveal pays the seller whether
 * or not the Kontor `detach` op executes:
 *
 *  - the buyer cannot pay the `Sponsor`'s gas → the detach is dropped silently
 *    (no result row anywhere) and the buyer pays for nothing;
 *  - the seller's `attach` never took effect → the escrow holds no asset, so
 *    there is nothing to deliver.
 *
 * Both are cheap `view` calls, so both are checked before anything is signed.
 */
export async function fillKontorSwap(
  swap: AtomicSwap,
  params: { kontorFundingUtxos?: KontorFunding; satsPerVbyte?: number },
  http: HttpClient,
  signer: Signer,
  ctx: KontorContext,
  options?: WorkflowOptions,
): Promise<PendingSale[]> {
  const progress = new WorkflowProgressReporter(
    "fillSwaps",
    options?.onProgress,
    5,
  );

  const { offerBlob, buyerTaproot } = progress.runSync("validateParams", () => {
    if (!swap.kontorOfferBlob) {
      throw new Error(`Swap ${swap.id} is a Kontor swap but has no offer blob`);
    }
    const addresses = signer.getAddresses();
    if (!addresses.p2tr) {
      throw new Error(
        "Kontor purchases require a P2TR address. Use a LocalSigner (privateKey) " +
          "with a testnet/signet network so a taproot address is derived.",
      );
    }
    return { offerBlob: swap.kontorOfferBlob, buyerTaproot: addresses.p2tr };
  });

  const signing = await getKontorSigning(signer, ctx.chain);
  const funding = resolveKontorFunding(
    http,
    buyerTaproot,
    ctx.btcNetwork,
    params.kontorFundingUtxos,
  );
  const session = makeKontorSession({
    chain: ctx.chain,
    signing,
    funding,
    indexerUrl: ctx.indexerUrl,
    // Fee rate for the buyer's commit + swap-reveal composed by the Kontor SDK
    // during accept(). Mirrors the seller's attach reveal in openKontorSellOrder.
    feeRate: params.satsPerVbyte,
  });

  try {
    await progress.runAsync("preflightKontor", async () => {
      // The same call `client.preflightKontorPurchase()` exposes — one gate, so
      // what a review screen reported and what the broadcast enforces cannot
      // drift apart. `assetUtxoId` is the attach reveal's output 0 for every
      // Kontor listing; a listing without one predates the escrow convention
      // and can't be verified, so it is left to `inspect()` alone.
      const verdict = await preflightKontorPurchase({
        session,
        indexerUrl: ctx.indexerUrl,
        fetch: ctx.fetch,
        escrowOutpoint: swap.assetUtxoId,
        assetKind: swap.kontorAssetKind,
        nftId: swap.kontorNftId,
        contractAddress: swap.kontorContractAddress,
        korAmount: swap.kontorAmount,
      });
      if (verdict.error) throw verdict.error;
    });

    const incoming = session.openOffer(offerBlob);

    await progress.runAsync("inspectKontorOffer", async () => {
      const inspection = await incoming.inspect();
      if (!inspection.valid) {
        throw new Error(inspection.problem ?? "Kontor offer is no longer valid");
      }
    });

    const buyerAddress = session.identity.address;

    const { txid } = await progress.runAsync("acceptKontorOffer", () =>
      incoming.accept(),
    );

    // The swap reveal is on-chain now: recording retries transient failures
    // itself (electrs lag, dropped responses), and a failure that survives them
    // must carry the txid so the purchase can be recovered without re-accepting
    // (mirrors KontorListingNotRecordedError / KontorDelistNotRecordedError).
    let pendingSale: PendingSale;
    try {
      pendingSale = await progress.runAsync("submitPurchase", () =>
        recordKontorPurchaseWithRetry(http, swap.id, buyerAddress, txid),
      );
    } catch (cause) {
      throw new KontorPurchaseNotRecordedError(swap.id, txid, buyerAddress, cause);
    }

    return [pendingSale];
  } finally {
    session.close();
  }
}
