import type { HttpClient } from "./http.js";
import type {
  FeeQuoteBtc,
  FeeQuoteZeldTransferPrep,
  RequestOptions,
} from "../types/index.js";

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireFeeQuoteBtcResponse {
  fee_payment_id: string;
  psbt: string;
  raw_transaction: string;
  inputs_to_sign: number[];
}

interface WireFeeQuoteZeldResponse {
  fee_payment_id: string;
  payment_address: string;
  payment_amount: number;
}

export type FeeQuoteParams =
  | {
      address: string;
      utxoSetIds: string[];
      /**
       * Feerate target for the PSBT (counterparty / ordinal) variant. Required —
       * the server has no default and returns `400` when it is omitted.
       */
      satsPerVbyte: number;
    }
  | { type: "zeld"; address: string };

/**
 * POST /api/atomic-swaps/fee-quotes
 *
 * Returns a discriminated union:
 * - FeeQuoteBtc when `psbt` is present in the response
 * - FeeQuoteZeldTransferPrep when `paymentAddress` is present
 */
export async function requestFeeQuote(
  http: HttpClient,
  params: FeeQuoteParams,
  options?: RequestOptions,
): Promise<FeeQuoteBtc | FeeQuoteZeldTransferPrep> {
  let body: Record<string, unknown>;

  if ("type" in params && params.type === "zeld") {
    body = { type: "zeld", address: params.address };
  } else {
    const { address, utxoSetIds, satsPerVbyte } = params as {
      address: string;
      utxoSetIds: string[];
      satsPerVbyte: number;
    };
    body = {
      address,
      utxo_set_ids: utxoSetIds,
      ...(satsPerVbyte !== undefined && { sats_per_vbyte: satsPerVbyte }),
    };
  }

  const wire = await http.request<
    WireFeeQuoteBtcResponse | WireFeeQuoteZeldResponse
  >("POST", "/api/atomic-swaps/fee-quotes", body, options?.signal);

  if ("psbt" in wire) {
    const btcWire = wire as WireFeeQuoteBtcResponse;
    return {
      feePaymentId: btcWire.fee_payment_id,
      psbt: btcWire.psbt,
      rawTransaction: btcWire.raw_transaction,
      inputsToSign: btcWire.inputs_to_sign,
    };
  }

  const zeldWire = wire as WireFeeQuoteZeldResponse;
  return {
    feePaymentId: zeldWire.fee_payment_id,
    paymentAddress: zeldWire.payment_address,
    paymentAmount: zeldWire.payment_amount,
  };
}
