import type { HttpClient } from "../api/http.js";
import { requestSellQuote } from "../api/sell-quotes.js";
import { createSwap } from "../api/atomic-swaps.js";
import type { Signer } from "../crypto/signer.js";
import { signAndFinalizeSellPrep } from "./sell-prep.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  ListingType,
} from "../types/index.js";
import {
  assertOrdinalSellerAddress,
  assertSellListingParams,
  assertTaprootSellerPubkey,
  assertZeldMainnet,
  resolveSellerPubkey,
} from "../sell-params.js";
import * as btc from "bitcoinjs-lib";

export interface OpenSellOrderParams {
  /** Asset UTXO id in `{txid}:{vout}` format. Omit for xcp attach prep or zeld transfer prep (server-composed). */
  assetUtxoId?: string;
  /** Asset name (required for xcp/zeld; optional display name for ordinals). */
  assetName?: string;
  /** Asset quantity (required for xcp/zeld). */
  assetQuantity?: bigint | number;
  /** Net sats the seller receives. Buyers pay price + royalty. */
  priceSats: number;
  /** Seller Bitcoin address. Auto-filled from signer (P2TR for ordinals, P2WPKH otherwise) if omitted. */
  sellerAddress?: string;
  /** 32-byte x-only seller pubkey for P2TR sellers. Auto-filled from signer when omitted. */
  sellerPubkey?: string;
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
 * 2. If prep_psbt is present: sign + finalize → attach commit tx hex (xcp) or zeld_payment (zeld transfer).
 * 3. Sign swap_psbt (PSBT hex, do NOT finalize).
 * 4. If fee_psbt is present: sign (PSBT hex, do NOT finalize).
 * 5. Create the swap listing.
 *
 * ZELD idempotency: HTTP 201 → `created: true`; HTTP 200 (same payload) → `created: false`;
 * HTTP 409 → throws `HorizonMarketApiError` (`Conflicting zeld listing`).
 */
export async function openSellOrder(
  params: OpenSellOrderParams,
  http: HttpClient,
  signer: Signer,
  network: "mainnet" | "testnet",
  btcNetwork: btc.Network,
): Promise<{ swap: AtomicSwap; created: boolean }> {
  assertZeldMainnet(params.listingType, network);
  assertSellListingParams(params);

  // Resolve seller address
  const addresses = signer.getAddresses();
  const sellerAddress = resolveSellerAddress(params, addresses);
  assertOrdinalSellerAddress(params.listingType, sellerAddress);

  const sellerPubkey = resolveSellerPubkey(
    sellerAddress,
    params.sellerPubkey,
    addresses,
  );
  assertTaprootSellerPubkey(sellerAddress, sellerPubkey);

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
  const prep = signAndFinalizeSellPrep(quote, signer, btcNetwork);
  const fundingTxHex = prep?.fundingTxHex;
  const revealTxHex = prep?.revealTxHex;
  const zeldPayment = prep?.zeldPayment;

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
    zeldPayment,
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

function resolveSellerAddress(
  params: OpenSellOrderParams,
  addresses: ReturnType<Signer["getAddresses"]>,
): string {
  if (params.sellerAddress !== undefined) {
    return params.sellerAddress;
  }
  if (params.listingType === "ordinal") {
    if (!addresses.p2tr) {
      throw new Error(
        "Ordinal listings require a P2TR seller address. Pass sellerAddress explicitly or use a signer that provides p2tr.",
      );
    }
    return addresses.p2tr;
  }
  return addresses.p2wpkh;
}
