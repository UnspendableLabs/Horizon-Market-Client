import type * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { Signer } from "../crypto/signer.js";
import type { SellQuote, ZeldPayment } from "../types/index.js";

/** Result of signing and finalizing a sell quote prep PSBT. */
export interface SignedSellPrepResult {
  /** Signed attach commit tx hex (counterparty attach prep). */
  fundingTxHex?: string;
  /** Reveal tx hex from the quote — pass unchanged on create (attach+reveal). */
  revealTxHex?: string;
  /** Finalized ZELD transfer prep tx (zeld transfer prep with on-chain fee). */
  zeldPayment?: ZeldPayment;
}

/**
 * Sign and finalize a sell quote's prep PSBT when present.
 *
 * - `prep_kind: "attach"` → `fundingTxHex` (+ optional `revealTxHex` from quote)
 * - `prep_kind: "zeld_transfer"` with on-chain fee → `zeldPayment`
 * - `prep_kind: "zeld_transfer"` with `feeWaived` → `fundingTxHex` (no payment objects on create)
 *
 * Returns `undefined` when the quote has no `prepPsbt`. Swap and fee PSBTs must
 * still be signed separately (as PSBT hex, not finalized).
 */
export async function signAndFinalizeSellPrep(
  quote: SellQuote,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<SignedSellPrepResult | undefined> {
  if (!quote.prepPsbt) return undefined;
  // `await`: external-wallet signers resolve asynchronously (popup prompt).
  const signedPrepHex = await signer.signPsbtHex(
    quote.prepPsbt,
    quote.prepInputsToSign,
  );
  return buildSellPrepResult(quote, signedPrepHex, btcNetwork);
}

/**
 * Finalize a signed prep PSBT and assemble the create-swap fields.
 *
 * Internal: callers must have already signed the prep PSBT (`signedPrepHex` is
 * a fully-signed-but-not-finalized PSBT hex). Exported for the staged workflow
 * in `sell.ts` which signs and finalizes as two separate progress steps.
 */
export function buildSellPrepResult(
  quote: SellQuote,
  signedPrepHex: string,
  btcNetwork: btc.Network,
): SignedSellPrepResult {
  if (quote.prepKind === "attach") {
    const { txHex } = finalizePsbtHex(signedPrepHex, btcNetwork);
    return {
      fundingTxHex: txHex,
      revealTxHex: quote.revealTxHex,
    };
  }

  if (quote.prepKind === "zeld_transfer") {
    const { txHex, txId } = finalizePsbtHex(signedPrepHex, btcNetwork);

    if (quote.feeWaived) {
      return { fundingTxHex: txHex };
    }

    if (!quote.feePaymentId) {
      throw new Error(
        "ZELD transfer prep requires feePaymentId when fee is not waived",
      );
    }

    return {
      zeldPayment: {
        zeldSendTxHex: txHex,
        zeldSendTxId: txId,
        feePaymentId: quote.feePaymentId,
      },
    };
  }

  throw new Error(
    `Unexpected prep_kind "${quote.prepKind}" with non-null prep_psbt`,
  );
}
