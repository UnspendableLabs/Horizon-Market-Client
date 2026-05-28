import type { HttpClient } from "../api/http.js";
import { requestSellQuote } from "../api/sell-quotes.js";
import { createSwap } from "../api/atomic-swaps.js";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { Signer } from "../crypto/signer.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  ListingType,
} from "../types/index.js";
import * as btc from "bitcoinjs-lib";

export interface OpenSellOrderParams {
  /** Asset UTXO id in `{txid}:{vout}` format. Omit for xcp attach prep (server-composed). */
  assetUtxoId?: string;
  /** Asset name (required for xcp/zeld; optional display name for ordinals). */
  assetName?: string;
  /** Asset quantity (required for xcp/zeld). */
  assetQuantity?: bigint | number;
  /** Net sats the seller receives. Buyers pay price + royalty. */
  priceSats: number;
  /** Seller Bitcoin address. Auto-filled from signer P2WPKH address if omitted. */
  sellerAddress?: string;
  /** Listing type. */
  listingType: ListingType;
  /** Optional listing expiry. Accepts Date (converted to ISO string) or ISO string. */
  expiresAt?: Date | string;
  /** Sat/vByte fee rate for the sell-quotes request. */
  satsPerVbyte?: number;
  /** Explicit fee UTXO ids. Mutually exclusive with autoSelectFeeUtxos. */
  feeUtxoIds?: string[];
  /** Ask server to auto-select fee UTXOs. Mutually exclusive with feeUtxoIds. */
  autoSelectFeeUtxos?: boolean;
}

/**
 * openSellOrder — quote → sign → submit
 *
 * Workflow:
 * 1. Request sell quote (server composes all PSBTs).
 * 2. If prep_psbt is present: sign + finalize → attach commit tx hex (xcp) or ZELD (Phase 7).
 * 3. Sign swap_psbt (PSBT hex, do NOT finalize).
 * 4. If fee_psbt is present: sign (PSBT hex, do NOT finalize).
 * 5. Create the swap listing.
 */
export async function openSellOrder(
  params: OpenSellOrderParams,
  http: HttpClient,
  signer: Signer,
  network: "mainnet" | "testnet",
  btcNetwork: btc.Network,
): Promise<{ swap: AtomicSwap; created: boolean }> {
  // Guard: ZELD is mainnet only
  if (params.listingType === "zeld" && network !== "mainnet") {
    throw new Error("ZELD listings are only supported on mainnet");
  }

  // Guard: ZELD transfer prep (no assetUtxoId) is Phase 7
  if (params.listingType === "zeld" && !params.assetUtxoId) {
    throw new Error(
      "ZELD transfer prep (without assetUtxoId) is not yet supported (Phase 7). " +
        "Provide assetUtxoId to sell from an existing ZELD UTXO.",
    );
  }

  // Resolve seller address
  const addresses = signer.getAddresses();
  const sellerAddress = params.sellerAddress ?? addresses.p2wpkh;

  // Auto-fill seller pubkey for P2TR sellers
  let sellerPubkey: string | undefined;
  if (addresses.p2tr && sellerAddress === addresses.p2tr) {
    sellerPubkey = addresses.xOnlyPubkey;
  }

  // Serialize expiresAt
  let expiresAt: string | null | undefined;
  if (params.expiresAt !== undefined) {
    expiresAt =
      params.expiresAt instanceof Date
        ? params.expiresAt.toISOString()
        : params.expiresAt;
  }

  // Step 1: Request sell quote
  const quote = await requestSellQuote(http, {
    price: params.priceSats,
    sellerAddress,
    sellerPubkey,
    listingType: params.listingType,
    assetUtxoId: params.assetUtxoId,
    assetName: params.assetName,
    assetQuantity: params.assetQuantity,
    satsPerVbyte: params.satsPerVbyte,
    feeUtxoIds: params.feeUtxoIds,
    autoSelectFeeUtxos: params.autoSelectFeeUtxos,
  });

  // Step 2: Handle prep PSBT (if present)
  let fundingTxHex: string | undefined;
  let revealTxHex: string | undefined;

  if (quote.prepPsbt) {
    // Sign the prep PSBT
    const signedPrepHex = signer.signPsbtHex(
      quote.prepPsbt,
      quote.prepInputsToSign,
    );

    if (quote.prepKind === "attach") {
      // Finalize → raw tx hex (attach commit)
      const { txHex } = finalizePsbtHex(signedPrepHex, btcNetwork);
      fundingTxHex = txHex;
      // Pass reveal_tx_hex unchanged from quote if present
      revealTxHex = quote.revealTxHex;
    } else if (quote.prepKind === "zeld_transfer") {
      // Phase 7 — should have been caught above for "zeld" type
      throw new Error(
        "ZELD transfer prep finalization is not yet supported (Phase 7)",
      );
    } else {
      throw new Error(
        `Unexpected prep_kind "${quote.prepKind}" with non-null prep_psbt`,
      );
    }
  }

  // Step 3: Sign swap PSBT (do NOT finalize)
  const signedSwapPsbt = signer.signPsbtHex(
    quote.swapPsbt,
    quote.swapInputsToSign,
  );

  // Step 4: Sign fee PSBT if present (do NOT finalize)
  let feePayment:
    | { psbtHex: string; feePaymentId: string }
    | undefined;
  if (quote.feePsbt) {
    const signedFeePsbt = signer.signPsbtHex(
      quote.feePsbt,
      quote.feeInputsToSign,
    );
    feePayment = {
      psbtHex: signedFeePsbt,
      feePaymentId: quote.feePaymentId,
    };
  }

  // Step 5: Build create request using quote-derived asset UTXO values
  const createReq: AtomicSwapCreateRequest = {
    assetUtxoId: quote.assetUtxoId,
    assetUtxoValue: quote.assetUtxoValue,
    price: params.priceSats,
    sellerAddress,
    psbtHex: signedSwapPsbt,
    listingType: params.listingType,
    assetName: params.assetName,
    assetQuantity: params.assetQuantity,
    expiresAt,
    feePayment,
    fundingTxHex,
    revealTxHex,
  };

  // Step 6: Create the swap
  const result = await createSwap(http, createReq);

  return {
    swap: result.swap,
    created: result.created,
  };
}
