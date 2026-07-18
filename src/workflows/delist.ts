import type { HttpClient } from "../api/http.js";
import { startDelist, confirmDelist } from "../api/delist.js";
import type { Signer } from "../crypto/signer.js";
import type { WorkflowOptions } from "../types/index.js";
import { WorkflowProgressReporter } from "./progress.js";

const DELIST_SWAP_TOTAL_STEPS = 3;

/**
 * delistSwap — start → sign (BIP322) → confirm
 *
 * Workflow:
 * 1. POST delist-requests to get the delist request id.
 * 2. Sign the request id with BIP322 using the seller address.
 * 3. PUT delist-requests/{id} with the signature to confirm.
 */
export async function delistSwap(
  swapId: string,
  http: HttpClient,
  signer: Signer,
  options?: WorkflowOptions,
): Promise<void> {
  const progress = new WorkflowProgressReporter(
    "delistSwap",
    options?.onProgress,
    DELIST_SWAP_TOTAL_STEPS,
  );

  const delistRequest = await progress.runAsync("startDelist", () =>
    startDelist(http, swapId),
  );

  // `runAsync`: external-wallet signers prompt asynchronously (popup).
  const signature = await progress.runAsync("signDelistMessage", () =>
    Promise.resolve(
      signer.signMessage(
        delistRequest.atomicSwap.sellerAddress,
        delistRequest.id,
      ),
    ),
  );

  await progress.runAsync("confirmDelist", () =>
    confirmDelist(http, delistRequest.id, signature),
  );
}
