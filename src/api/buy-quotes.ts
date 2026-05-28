import type { HttpClient } from "./http.js";
import type { BuyQuote, BuyQuoteParams, RequestOptions } from "../types/index.js";

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireBuyQuoteResponse {
  psbt: string;
  inputs_to_sign: number[];
  fee_estimate_sats: number;
  royalty_sats: number;
  royalty_address: string | null;
}

interface WireBuyQuoteBody {
  swap_ids: string[];
  buyer_address: string;
  buyer_taproot_address?: string;
  sats_per_vbyte?: number;
  funding_utxo_ids?: string[];
  auto_select?: boolean;
  detach?: boolean;
}

/** POST /api/atomic-swaps/buy-quotes — compose unsigned buyer PSBT. */
export async function requestBuyQuote(
  http: HttpClient,
  params: BuyQuoteParams,
  options?: RequestOptions,
): Promise<BuyQuote> {
  const body: WireBuyQuoteBody = {
    swap_ids: params.swapIds,
    buyer_address: params.buyerAddress,
  };

  if (params.buyerTaprootAddress !== undefined)
    body.buyer_taproot_address = params.buyerTaprootAddress;
  if (params.satsPerVbyte !== undefined)
    body.sats_per_vbyte = params.satsPerVbyte;
  if (params.fundingUtxoIds !== undefined)
    body.funding_utxo_ids = params.fundingUtxoIds;
  if (params.autoSelect !== undefined) body.auto_select = params.autoSelect;
  if (params.detach !== undefined) body.detach = params.detach;

  const wire = await http.request<WireBuyQuoteResponse>(
    "POST",
    "/api/atomic-swaps/buy-quotes",
    body,
    options?.signal,
  );

  return {
    psbt: wire.psbt,
    inputsToSign: wire.inputs_to_sign,
    feeEstimateSats: wire.fee_estimate_sats,
    royaltySats: wire.royalty_sats,
    royaltyAddress: wire.royalty_address,
  };
}
