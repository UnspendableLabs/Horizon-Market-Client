import type { HttpClient } from "../api/http.js";
import type { Signer } from "../crypto/signer.js";
import { kontorBuy } from "../api/kontor.js";
import { resolveKontorFunding } from "../kontor/funding.js";
import { makeKontorSession } from "../kontor/session.js";
import { getKontorSigning } from "../kontor/signing.js";
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
 * purchase with Horizon failed. The offer is CONSUMED — do not retry
 * `fillSwaps` (it would fail at inspect). Retry only the recording POST with the
 * carried `txId`, or wait for the indexer to settle the purchase.
 */
export class KontorPurchaseNotRecordedError extends Error {
  readonly swapId: string;
  /** Txid of the already-broadcast swap reveal. */
  readonly txId: string;
  readonly buyerAddress: string;
  override readonly cause?: unknown;

  constructor(swapId: string, txId: string, buyerAddress: string, cause: unknown) {
    super(
      "Kontor offer was accepted on-chain (swap reveal broadcast) but the " +
        "purchase could not be recorded server-side. Do NOT retry fillSwaps — " +
        "the offer is already consumed. Retry recording with the carried txId.",
    );
    this.name = "KontorPurchaseNotRecordedError";
    this.swapId = swapId;
    this.txId = txId;
    this.buyerAddress = buyerAddress;
    this.cause = cause;
  }
}

/**
 * fillKontorSwap — inspect offer → accept (broadcast swap reveal, client-side SDK) → record.
 *
 * The buyer's commit + swap reveal are composed, signed, and broadcast by the
 * Kontor SDK locally; the private key never leaves the client. Only the buyer
 * address and swap-reveal txid are sent to Horizon.
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
    4,
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

    // The swap reveal is on-chain now: a failure recording it must carry the
    // txid so the purchase can be recovered without re-accepting (mirrors
    // KontorListingNotRecordedError / KontorDelistNotRecordedError).
    let pendingSale: PendingSale;
    try {
      pendingSale = await progress.runAsync("submitPurchase", () =>
        kontorBuy(http, swap.id, { buyerAddress, txId: txid }),
      );
    } catch (cause) {
      throw new KontorPurchaseNotRecordedError(swap.id, txid, buyerAddress, cause);
    }

    return [pendingSale];
  } finally {
    session.close();
  }
}
