import { Offer } from "@kontor/sdk";
import type { HttpClient } from "../api/http.js";
import { startDelist, confirmDelist } from "../api/delist.js";
import type { Signer } from "../crypto/signer.js";
import { resolveKontorFunding } from "../kontor/funding.js";
import { makeKontorSession } from "../kontor/session.js";
import { getKontorSigning } from "../kontor/signing.js";
import type { KontorContext } from "../kontor/context.js";
import type {
  AtomicSwap,
  KontorFunding,
  WorkflowOptions,
} from "../types/index.js";
import { WorkflowProgressReporter } from "./progress.js";

/**
 * Thrown when the Kontor offer was already revoked on-chain (escrow reclaimed)
 * but the server-side BIP322 delist did not complete. The asset is NOT at risk —
 * the listing is now unfulfillable (a buyer's `accept()` would double-spend the
 * reclaimed escrow and fail) — but it may still show as active server-side.
 * Safe to retry: the revoke has already happened, so only the server delist needs
 * to be re-run (`startDelist` → sign → `confirmDelist`) for swap `swapId`.
 */
export class KontorDelistNotRecordedError extends Error {
  readonly swapId: string;
  override readonly cause?: unknown;

  constructor(swapId: string, cause: unknown) {
    super(
      "Kontor offer was revoked on-chain (escrow reclaimed) but the listing " +
        "could not be marked delisted server-side. Retry the delist; the " +
        "on-chain revoke will not be repeated.",
    );
    this.name = "KontorDelistNotRecordedError";
    this.swapId = swapId;
    this.cause = cause;
  }
}

/**
 * delistKontorSwap — revoke offer on-chain (reclaim escrow) → BIP322 delist.
 *
 * Step 1 reclaims the escrowed asset via the SDK's `Offer.revoke()` (composed,
 * signed, broadcast locally — key never leaves the client). Step 2 marks the
 * listing delisted with a BIP322 signature over the delist request id, signed
 * with the seller's taproot address — identical to the PSBT delist flow.
 *
 * If the revoke succeeds but the server-side delist fails, a
 * {@link KontorDelistNotRecordedError} is thrown so the caller knows the
 * on-chain reclaim already happened and only the server delist must be retried.
 */
export async function delistKontorSwap(
  swap: AtomicSwap,
  params: { fundingUtxos?: KontorFunding },
  http: HttpClient,
  signer: Signer,
  ctx: KontorContext,
  options?: WorkflowOptions,
): Promise<void> {
  const progress = new WorkflowProgressReporter(
    "delistSwap",
    options?.onProgress,
    4,
  );

  const offerBlob = swap.kontorOfferBlob;
  if (!offerBlob) {
    throw new Error(`Swap ${swap.id} is a Kontor swap but has no offer blob`);
  }

  await progress.runAsync("revokeKontorOffer", async () => {
    const signing = await getKontorSigning(signer, ctx.chain);
    const funding = resolveKontorFunding(
      http,
      swap.sellerAddress,
      ctx.btcNetwork,
      params.fundingUtxos,
    );
    const session = makeKontorSession({
      chain: ctx.chain,
      signing,
      funding,
      indexerUrl: ctx.indexerUrl,
    });
    try {
      const offer = new Offer(session, JSON.parse(offerBlob));
      await offer.revoke();
    } finally {
      session.close();
    }
  });

  // The escrow is reclaimed on-chain now. A failure past this point leaves the
  // listing unfulfillable but possibly still active server-side, so surface it
  // as a retry-safe error rather than a generic throw.
  try {
    const delistRequest = await progress.runAsync("startDelist", () =>
      startDelist(http, swap.id),
    );

    const signature = progress.runSync("signDelistMessage", () =>
      signer.signMessage(
        delistRequest.atomicSwap.sellerAddress,
        delistRequest.id,
      ),
    );

    await progress.runAsync("confirmDelist", () =>
      confirmDelist(http, delistRequest.id, signature),
    );
  } catch (cause) {
    throw new KontorDelistNotRecordedError(swap.id, cause);
  }
}
