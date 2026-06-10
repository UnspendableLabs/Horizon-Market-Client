import type { HttpClient } from "../api/http.js";
import { requestBuyQuote } from "../api/buy-quotes.js";
import { purchaseSwaps } from "../api/atomic-swaps.js";
import { assertBuyQuoteParams } from "../buy-params.js";
import type { Signer } from "../crypto/signer.js";
import type {
  BuyQuoteParams,
  KontorFunding,
  PendingSale,
  WorkflowOptions,
} from "../types/index.js";
import { WorkflowProgressReporter } from "./progress.js";

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
  /** Detach the asset from the UTXO (counterparty only; default true). */
  detach?: boolean;
  /**
   * Funding UTXOs for a Kontor buyer commit (only used when the target swap is
   * `listingType: "kontor"`). Static list, fetcher, or omitted to auto-fetch the
   * buyer's confirmed taproot UTXOs from Horizon.
   */
  kontorFundingUtxos?: KontorFunding;
}

const FILL_SWAPS_TOTAL_STEPS = 4;

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
  options?: WorkflowOptions,
): Promise<PendingSale[]> {
  const progress = new WorkflowProgressReporter(
    "fillSwaps",
    options?.onProgress,
    FILL_SWAPS_TOTAL_STEPS,
  );

  const { buyerAddress, quoteParams } = progress.runSync("validateParams", () => {
    const addresses = signer.getAddresses();
    const resolvedBuyerAddress = params.buyerAddress ?? addresses.p2wpkh;

    assertBuyQuoteParams({
      swapIds: params.swapIds,
      buyerAddress: resolvedBuyerAddress,
      buyerTaprootAddress: params.buyerTaprootAddress,
      satsPerVbyte: params.satsPerVbyte,
      fundingUtxoIds: params.fundingUtxoIds,
      autoSelect: params.autoSelect,
      detach: params.detach,
    });

    if (
      params.buyerTaprootAddress !== undefined &&
      params.swapIds.length !== 1
    ) {
      throw new Error(
        "Ordinal buys require exactly one swapId (got " +
          params.swapIds.length +
          ")",
      );
    }

    const resolvedQuoteParams: BuyQuoteParams = {
      swapIds: params.swapIds,
      buyerAddress: resolvedBuyerAddress,
      buyerTaprootAddress: params.buyerTaprootAddress,
      satsPerVbyte: params.satsPerVbyte,
      fundingUtxoIds: params.fundingUtxoIds,
      autoSelect: params.autoSelect,
      detach: params.detach ?? true,
    };

    return {
      buyerAddress: resolvedBuyerAddress,
      quoteParams: resolvedQuoteParams,
    };
  });

  const quote = await progress.runAsync("requestBuyQuote", () =>
    requestBuyQuote(http, quoteParams),
  );

  const signedPsbtHex = progress.runSync("signBuyerPsbt", () =>
    signer.signPsbtHex(quote.psbt, quote.inputsToSign),
  );

  return progress.runAsync("submitPurchase", () =>
    purchaseSwaps(http, {
      swapIds: params.swapIds,
      buyerAddress,
      psbtHex: signedPsbtHex,
    }),
  );
}
