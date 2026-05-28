import type { HttpClient } from "./http.js";
import type {
  ListingType,
  SellQuote,
  SellQuoteParams,
  PrepKind,
  RequestOptions,
} from "../types/index.js";
import { serializeAssetQuantity } from "../utils.js";

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireSellQuoteResponse {
  swap_psbt: string;
  swap_inputs_to_sign: number[];
  fee_psbt: string | null;
  fee_inputs_to_sign: number[];
  fee_payment_id: string | null;
  fee_waived: boolean;
  asset_utxo_id: string;
  asset_utxo_value: number;
  prep_psbt: string | null;
  prep_inputs_to_sign: number[];
  prep_kind: "zeld_transfer" | "attach" | null;
  reveal_tx_hex?: string;
  payment_address?: string;
  payment_amount?: number;
}

interface WireSellQuoteBody {
  price: number;
  seller_address: string;
  seller_pubkey?: string;
  listing_type?: ListingType;
  asset_utxo_id?: string;
  asset_name?: string;
  asset_quantity?: number | string;
  sats_per_vbyte?: number;
  fee_utxo_ids?: string[];
  auto_select_fee_utxos?: boolean;
}

/** POST /api/atomic-swaps/sell-quotes — compose unsigned sell PSBTs. */
export async function requestSellQuote(
  http: HttpClient,
  params: SellQuoteParams,
  options?: RequestOptions,
): Promise<SellQuote> {
  const body: WireSellQuoteBody = {
    price: params.price,
    seller_address: params.sellerAddress,
  };

  if (params.sellerPubkey !== undefined) body.seller_pubkey = params.sellerPubkey;
  if (params.listingType !== undefined) body.listing_type = params.listingType;
  if (params.assetUtxoId !== undefined) body.asset_utxo_id = params.assetUtxoId;
  if (params.assetName !== undefined) body.asset_name = params.assetName;
  if (params.assetQuantity !== undefined)
    body.asset_quantity = serializeAssetQuantity(params.assetQuantity);
  if (params.satsPerVbyte !== undefined)
    body.sats_per_vbyte = params.satsPerVbyte;
  if (params.feeUtxoIds !== undefined) body.fee_utxo_ids = params.feeUtxoIds;
  if (params.autoSelectFeeUtxos !== undefined)
    body.auto_select_fee_utxos = params.autoSelectFeeUtxos;

  const wire = await http.request<WireSellQuoteResponse>(
    "POST",
    "/api/atomic-swaps/sell-quotes",
    body,
    options?.signal,
  );

  return {
    swapPsbt: wire.swap_psbt,
    swapInputsToSign: wire.swap_inputs_to_sign,
    feePsbt: wire.fee_psbt,
    feeInputsToSign: wire.fee_inputs_to_sign,
    feePaymentId: wire.fee_payment_id,
    feeWaived: wire.fee_waived,
    assetUtxoId: wire.asset_utxo_id,
    assetUtxoValue: wire.asset_utxo_value,
    prepPsbt: wire.prep_psbt,
    prepInputsToSign: wire.prep_inputs_to_sign,
    prepKind: wire.prep_kind as PrepKind,
    revealTxHex: wire.reveal_tx_hex,
    paymentAddress: wire.payment_address,
    paymentAmount: wire.payment_amount,
  };
}
