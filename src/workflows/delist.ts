import type { HttpClient } from "../api/http.js";
import { startDelist, confirmDelist } from "../api/delist.js";
import type { Signer } from "../crypto/signer.js";

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
): Promise<void> {
  // Step 1: Start delist — get request id and seller address
  const delistRequest = await startDelist(http, swapId);

  // Step 2: Sign the delist request id with BIP322
  const signature = signer.signMessage(
    delistRequest.atomicSwap.sellerAddress,
    delistRequest.id,
  );

  // Step 3: Confirm delist
  await confirmDelist(http, delistRequest.id, signature);
}
