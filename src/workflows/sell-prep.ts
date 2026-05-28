import type * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { Signer } from "../crypto/signer.js";
import type { SellQuote, ZeldPayment } from "../types/index.js";

/** Result of signing and finalizing a sell quote prep PSBT. */
export interface SignedSellPrepResult {
  /** Signed attach commit tx hex (xcp attach prep). */
  fundingTxHex?: string;
  /** Reveal tx hex from the quote — pass unchanged on create (attach+reveal). */
  revealTxHex?: string;
  /** Finalized ZELD transfer prep tx (zeld transfer prep). */
  zeldPayment?: ZeldPayment;
}

/**
 * Sign and finalize a sell quote's prep PSBT when present.
 *
 * - `prep_kind: "attach"` → `fundingTxHex` (+ optional `revealTxHex` from quote)
 * - `prep_kind: "zeld_transfer"` → `zeldPayment` with raw tx hex/tid
 *
 * Returns `undefined` when the quote has no `prepPsbt`. Swap and fee PSBTs must
 * still be signed separately (as PSBT hex, not finalized).
 */
export function signAndFinalizeSellPrep(
  quote: SellQuote,
  signer: Signer,
  btcNetwork: btc.Network,
): SignedSellPrepResult | undefined {
  if (!quote.prepPsbt) return undefined;

  const signedPrepHex = signer.signPsbtHex(
    quote.prepPsbt,
    quote.prepInputsToSign,
  );

  if (quote.prepKind === "attach") {
    const { txHex } = finalizePsbtHex(signedPrepHex, btcNetwork);
    return {
      fundingTxHex: txHex,
      revealTxHex: quote.revealTxHex,
    };
  }

  if (quote.prepKind === "zeld_transfer") {
    const { txHex, txId } = finalizePsbtHex(signedPrepHex, btcNetwork);
    return {
      zeldPayment: {
        zeldSendTxHex: txHex,
        zeldSendTxid: txId,
        feePaymentId: quote.feePaymentId,
      },
    };
  }

  throw new Error(
    `Unexpected prep_kind "${quote.prepKind}" with non-null prep_psbt`,
  );
}
