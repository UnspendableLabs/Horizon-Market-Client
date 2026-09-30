import type * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import {
  assertCommitUnchanged,
  readRevealCommit,
  revealToSign,
  signerKeys,
  signVerifiedReveal,
  verifyReveal,
  type RevealSigningMaterial,
  type VerifiedReveal,
} from "../crypto/reveal.js";
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

/** The keys of a signer's addresses a reveal is checked against. */
type RevealKeys = Pick<ReturnType<Signer["getAddresses"]>, "publicKey" | "xOnlyPubkey">;

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
 * @throws {RevealVerificationError} when the reveal does not check out against
 * the commit, its funding address or this wallet's keys — before anything is
 * signed — or when the wallet changed the commit while signing it.
 */
export async function signAndFinalizeSellPrep(
  quote: SellQuote,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<SignedSellPrepResult | undefined> {
  if (!quote.prepPsbt) return undefined;
  // Before any prompt: a reveal this wallet cannot sign makes the whole prep
  // pointless, so the seller is not asked for a commit signature first.
  const reveal = verifySellQuoteReveal(quote, signer.getAddresses());
  // `await`: external-wallet signers resolve asynchronously (popup prompt).
  const signedPrepHex = await signer.signPsbtHex(
    quote.prepPsbt,
    quote.prepInputsToSign,
  );
  const prep = finalizeSellPrep(quote, signedPrepHex, btcNetwork);
  if (reveal) {
    prep.revealTxHex = await signSellReveal(
      reveal,
      quote.prepPsbt,
      signedPrepHex,
      signer,
      btcNetwork,
    );
  }
  return prep;
}

/**
 * Whether a sell quote's reveal, if any, can be signed and broadcast safely:
 * not pre-signed, riding an attach commit, and consistent with that commit and
 * its funding address (see `verifyReveal`). Pass the wallet's `addresses` to
 * also check the envelope is closed by a key this wallet can sign with.
 *
 * @throws {PresignedRevealError} a reveal without its signing material —
 * pre-signed server-side with a throwaway key, which the network has ignored
 * since Counterparty Core v11.5.0.
 * @throws {RevealVerificationError} the reveal does not check out.
 */
export function assertSellQuoteRevealSignable(
  quote: SellQuote,
  addresses?: RevealKeys,
): void {
  verifySellQuoteReveal(quote, addresses);
}

/**
 * {@link assertSellQuoteRevealSignable}, returning the verified reveal to sign
 * — `null` when the quote carries none. Internal: the sell workflow checks the
 * quote with it once, before any prompt, and signs what it returns.
 */
export function verifySellQuoteReveal(
  quote: SellQuote,
  addresses?: RevealKeys,
): VerifiedReveal | null {
  const pair = sellQuoteReveal(quote);
  if (!pair) return null;
  return verifyReveal(pair.revealTxHex, pair.material, {
    ...readRevealCommit(pair.prepPsbt),
    expectedKeys: addresses ? signerKeys(addresses) : undefined,
  });
}

/**
 * The reveal a sell quote asks the seller to sign, with the attach commit it
 * spends — or `null` when there is none. Structural only: nothing is parsed.
 */
function sellQuoteReveal(
  quote: SellQuote,
): { revealTxHex: string; material: RevealSigningMaterial; prepPsbt: string } | null {
  const pair = revealToSign("The sell quote", quote.revealTxHex, quote.revealSigning);
  if (!pair) return null;
  if (quote.prepKind !== "attach" || !quote.prepPsbt) {
    throw new Error(
      "The sell quote carries a reveal but no attach commit for it to spend.",
    );
  }
  return { ...pair, prepPsbt: quote.prepPsbt };
}

/**
 * Sign the attach reveal of a taproot-envelope sell quote against the signed
 * commit (`fundingTxHex`, as {@link buildSellPrepResult} finalized it). The
 * reveal is verified against that commit, its funding address and the signer's
 * keys before the signer is asked for anything.
 */
export async function signSellPrepReveal(
  quote: SellQuote,
  fundingTxHex: string,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<string> {
  const pair = sellQuoteReveal(quote);
  if (!pair) throw new Error("The sell quote has no reveal to sign.");
  const verified = verifyReveal(pair.revealTxHex, pair.material, {
    commitTxHex: fundingTxHex,
    sourceScriptPubkey: readRevealCommit(pair.prepPsbt).sourceScriptPubkey,
    expectedKeys: signerKeys(signer.getAddresses()),
  });
  const signed = await signVerifiedReveal(verified, signer, btcNetwork);
  return signed.revealTxHex;
}

/**
 * Sign a reveal {@link verifySellQuoteReveal} checked against the quoted
 * commit, once the wallet has signed that commit. Internal: the sell workflow's
 * second half.
 *
 * @throws {RevealVerificationError} when the wallet changed the commit while
 * signing it — the reveal would spend a txid that is never broadcast.
 */
export async function signSellReveal(
  reveal: VerifiedReveal,
  quotedPrepPsbt: string,
  signedPrepHex: string,
  signer: Signer,
  btcNetwork: btc.Network,
): Promise<string> {
  assertCommitUnchanged(quotedPrepPsbt, signedPrepHex);
  const signed = await signVerifiedReveal(reveal, signer, btcNetwork);
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
 *
 * @throws {PresignedRevealError} when the quote carries a reveal the server
 * pre-signed: there would be no reveal this wallet can sign to list with.
 */
export function buildSellPrepResult(
  quote: SellQuote,
  signedPrepHex: string,
  btcNetwork: btc.Network,
): SignedSellPrepResult {
  sellQuoteReveal(quote);
  return finalizeSellPrep(quote, signedPrepHex, btcNetwork);
}

/**
 * {@link buildSellPrepResult} without its reveal check, for a workflow that
 * already verified the quote before asking for the prep signature.
 */
export function finalizeSellPrep(
  quote: SellQuote,
  signedPrepHex: string,
  btcNetwork: btc.Network,
): SignedSellPrepResult {
  if (quote.prepKind === "attach") {
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
