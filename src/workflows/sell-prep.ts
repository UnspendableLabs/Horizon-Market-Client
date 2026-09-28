import * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import { PresignedRevealError, signReveal } from "../crypto/reveal.js";
import type { Signer } from "../crypto/signer.js";
import type { SellQuote, ZeldPayment } from "../types/index.js";

/** Result of signing and finalizing a sell quote prep PSBT. */
export interface SignedSellPrepResult {
  /** Signed attach commit tx hex (counterparty attach prep). */
  fundingTxHex?: string;
  /**
   * Attach in a taproot envelope: the reveal **signed by the seller** — pass on
   * create, the server broadcasts it after the commit. Set by
   * {@link signAndFinalizeSellPrep}; {@link buildSellPrepResult} alone leaves
   * it unset because signing needs the signer.
   */
  revealTxHex?: string;
  /** Finalized ZELD transfer prep tx (zeld transfer prep with on-chain fee). */
  zeldPayment?: ZeldPayment;
}

/**
 * Sign and finalize a sell quote's prep PSBT when present.
 *
 * - `prep_kind: "attach"` → `fundingTxHex` (+ `revealTxHex`, signed here, when
 *   the attach travels in a taproot envelope)
 * - `prep_kind: "zeld_transfer"` with on-chain fee → `zeldPayment`
 * - `prep_kind: "zeld_transfer"` with `feeWaived` → `fundingTxHex` (no payment objects on create)
 *
 * Returns `undefined` when the quote has no `prepPsbt`. Swap and fee PSBTs must
 * still be signed separately (as PSBT hex, not finalized).
 *
 * @throws {PresignedRevealError} when the quote carries a reveal the server
 * pre-signed (no `revealSigning`): the network ignores it, so nothing is signed.
 */
export async function signAndFinalizeSellPrep(
  quote: SellQuote,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<SignedSellPrepResult | undefined> {
  if (!quote.prepPsbt) return undefined;
  // Before any prompt: a reveal this wallet cannot sign makes the whole prep
  // pointless, so the seller is not asked for a commit signature first.
  assertSellQuoteRevealSignable(quote);
  // `await`: external-wallet signers resolve asynchronously (popup prompt).
  const signedPrepHex = await signer.signPsbtHex(
    quote.prepPsbt,
    quote.prepInputsToSign,
  );
  const prep = buildSellPrepResult(quote, signedPrepHex, btcNetwork);
  if (prep.fundingTxHex && quote.revealSigning) {
    prep.revealTxHex = await signSellPrepReveal(
      quote,
      prep.fundingTxHex,
      signer,
      btcNetwork,
    );
  }
  return prep;
}

/**
 * Refuse a quote whose reveal this wallet cannot sign: a reveal without its
 * signing material was pre-signed server-side with a throwaway key, which the
 * network has ignored since Counterparty Core v11.5.0.
 */
export function assertSellQuoteRevealSignable(quote: SellQuote): void {
  if (quote.revealTxHex && !quote.revealSigning) {
    throw new PresignedRevealError("The sell quote");
  }
  if (quote.revealSigning && !quote.revealTxHex) {
    throw new Error(
      "The sell quote carries reveal signing material but no reveal transaction.",
    );
  }
}

/**
 * Sign the attach reveal of a taproot-envelope sell quote against the signed
 * commit (`fundingTxHex`). The reveal binds to the commit's txid, which segwit
 * signing cannot move — `signReveal` checks that, and that the envelope is
 * closed by one of the signer's keys, before asking for a signature.
 */
export async function signSellPrepReveal(
  quote: SellQuote,
  fundingTxHex: string,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<string> {
  assertSellQuoteRevealSignable(quote);
  if (!quote.revealSigning || !quote.revealTxHex) {
    throw new Error("The sell quote has no reveal to sign.");
  }
  const signed = await signReveal({
    revealTxHex: quote.revealTxHex,
    material: quote.revealSigning,
    commitTxHex: fundingTxHex,
    signer,
    network: btcNetwork,
  });
  return signed.revealTxHex;
}

/**
 * Finalize a signed prep PSBT and assemble the create-swap fields.
 *
 * Internal: callers must have already signed the prep PSBT (`signedPrepHex` is
 * a fully-signed-but-not-finalized PSBT hex). Exported for the staged workflow
 * in `sell.ts` which signs and finalizes as two separate progress steps. The
 * attach reveal, when there is one, is signed afterwards by
 * {@link signSellPrepReveal} — never passed through from the quote.
 */
export function buildSellPrepResult(
  quote: SellQuote,
  signedPrepHex: string,
  btcNetwork: btc.Network,
): SignedSellPrepResult {
  if (quote.prepKind === "attach") {
    assertSellQuoteRevealSignable(quote);
    const { txHex } = finalizePsbtHex(signedPrepHex, btcNetwork);
    return { fundingTxHex: txHex };
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
