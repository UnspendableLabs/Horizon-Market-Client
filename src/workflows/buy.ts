import type { HttpClient } from "../api/http.js";
import { requestBuyQuote } from "../api/buy-quotes.js";
import { purchaseSwaps } from "../api/atomic-swaps.js";
import type { Signer } from "../crypto/signer.js";
import type { BuyQuoteParams, PendingSale } from "../types/index.js";

export interface FillSwapsParams {
  swapIds: string[];
  /** P2WPKH address that funds the purchase. Auto-filled from signer if omitted. */
  buyerAddress?: string;
  /** P2TR address that receives the inscription (required for ordinals). */
  buyerTaprootAddress?: string;
  satsPerVbyte?: number;
  /** Explicit funding UTXO ids. Mutually exclusive with autoSelect. */
  fundingUtxoIds?: string[];
  /** Ask server to auto-select funding UTXOs. Mutually exclusive with fundingUtxoIds. */
  autoSelect?: boolean;
  /** Detach the asset from the UTXO (xcp only; default true). */
  detach?: boolean;
}

/**
 * fillSwaps — quote → sign → submit purchase
 *
 * Workflow:
 * 1. Request buy quote.
 * 2. Sign buyer PSBT inputs (preserve input order — critical for detach OP_RETURN).
 * 3. Submit purchase.
 */
export async function fillSwaps(
  params: FillSwapsParams,
  http: HttpClient,
  signer: Signer,
): Promise<PendingSale[]> {
  const addresses = signer.getAddresses();
  const buyerAddress = params.buyerAddress ?? addresses.p2wpkh;

  // Validate buyer address is P2WPKH (bc1q... / tb1q...)
  if (!buyerAddress.startsWith("bc1q") && !buyerAddress.startsWith("tb1q")) {
    throw new Error(
      `Buyer address must be P2WPKH (bc1q… or tb1q…), got: ${buyerAddress}`,
    );
  }

  // Ordinal buys: exactly one swap id and a taproot receive address are required
  if (params.buyerTaprootAddress !== undefined) {
    if (params.swapIds.length !== 1) {
      throw new Error(
        "Ordinal buys require exactly one swapId (got " +
          params.swapIds.length +
          ")",
      );
    }
  }

  const quoteParams: BuyQuoteParams = {
    swapIds: params.swapIds,
    buyerAddress,
    buyerTaprootAddress: params.buyerTaprootAddress,
    satsPerVbyte: params.satsPerVbyte,
    fundingUtxoIds: params.fundingUtxoIds,
    autoSelect: params.autoSelect,
    detach: params.detach,
  };

  // Step 1: Request buy quote
  const quote = await requestBuyQuote(http, quoteParams);

  // Step 2: Sign buyer PSBT — preserve input order (detach OP_RETURN keyed on input 0)
  const signedPsbtHex = signer.signPsbtHex(quote.psbt, quote.inputsToSign);

  // Step 3: Submit purchase
  return purchaseSwaps(http, {
    swapIds: params.swapIds,
    buyerAddress,
    psbtHex: signedPsbtHex,
  });
}
