import type { HttpClient } from "./http.js";
import type { ConfirmDelistResult, DelistRequest } from "../types/index.js";

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireDelistRequest {
  id: string;
  atomic_swap: { id: string; seller_address: string };
}

interface WireConfirmDelistResult {
  id: string;
  signature: string;
}

/**
 * POST /api/atomic-swaps/{id}/delist-requests
 *
 * Start a delist flow. Returns a DelistRequest whose `id` must be BIP322-signed.
 */
export async function startDelist(
  http: HttpClient,
  atomicSwapId: string,
): Promise<DelistRequest> {
  const wire = await http.request<WireDelistRequest>(
    "POST",
    `/api/atomic-swaps/${atomicSwapId}/delist-requests`,
    {},
  );

  return {
    id: wire.id,
    atomicSwap: {
      id: wire.atomic_swap.id,
      sellerAddress: wire.atomic_swap.seller_address,
    },
  };
}

/**
 * PUT /api/atomic-swaps/delist-requests/{requestId}
 *
 * Confirm delist with BIP322 signature over the delist request id.
 */
export async function confirmDelist(
  http: HttpClient,
  requestId: string,
  signature: string,
): Promise<ConfirmDelistResult> {
  const wire = await http.request<WireConfirmDelistResult>(
    "PUT",
    `/api/atomic-swaps/delist-requests/${requestId}`,
    { signature },
  );

  return {
    id: wire.id,
    signature: wire.signature,
  };
}
