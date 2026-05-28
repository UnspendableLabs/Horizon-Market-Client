import type { HttpClient } from "../api/http.js";
import { requestSellQuote } from "../api/sell-quotes.js";
import { createSwap } from "../api/atomic-swaps.js";
import type { Signer } from "../crypto/signer.js";
import { buildSellPrepResult, type SignedSellPrepResult } from "./sell-prep.js";
import { WorkflowProgressReporter } from "./progress.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  ListingType,
  WorkflowOptions,
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
  /** Asset UTXO id in `{txid}:{vout}` format. Omit for counterparty attach prep or zeld transfer prep (server-composed). */
  assetUtxoId?: string;
  /** Asset name (required for counterparty/zeld; optional display name for ordinals). */
  assetName?: string;
  /** Asset quantity (required for counterparty/zeld). */
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
 * 2. If prep_psbt is present: sign + finalize → attach commit tx hex (counterparty) or zeld_payment / funding_tx_hex (zeld transfer).
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
  options?: WorkflowOptions,
): Promise<{ swap: AtomicSwap; created: boolean }> {
  const progress = new WorkflowProgressReporter(
    "openSellOrder",
    options?.onProgress,
  );

  const { sellerAddress, sellerPubkey, expiresAt } = progress.runSync(
    "validateParams",
    () => {
      assertZeldMainnet(params.listingType, network);
      assertSellListingParams(params);

      const addresses = signer.getAddresses();
      const resolvedSellerAddress = resolveSellerAddress(params, addresses);
      assertOrdinalSellerAddress(params.listingType, resolvedSellerAddress);

      const resolvedSellerPubkey = resolveSellerPubkey(
        resolvedSellerAddress,
        params.sellerPubkey,
        addresses,
      );
      assertTaprootSellerPubkey(resolvedSellerAddress, resolvedSellerPubkey);

      let resolvedExpiresAt: string | null | undefined;
      if (params.expiresAt !== undefined) {
        resolvedExpiresAt =
          params.expiresAt instanceof Date
            ? params.expiresAt.toISOString()
            : params.expiresAt;
      }

      return {
        sellerAddress: resolvedSellerAddress,
        sellerPubkey: resolvedSellerPubkey,
        expiresAt: resolvedExpiresAt,
      };
    },
  );

  const quote = await progress.runAsync("requestSellQuote", () =>
    requestSellQuote(http, {
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
    }),
  );

  // Base: validateParams + requestSellQuote + signSwapPsbt + createSwap
  progress.setTotalSteps(
    4 + (quote.prepPsbt ? 2 : 0) + (quote.feePsbt ? 1 : 0),
  );

  let prep: SignedSellPrepResult | undefined;
  if (quote.prepPsbt) {
    const signedPrepHex = progress.runSync("signPrepPsbt", () =>
      signer.signPsbtHex(quote.prepPsbt!, quote.prepInputsToSign),
    );
    prep = progress.runSync("finalizePrepPsbt", () =>
      buildSellPrepResult(quote, signedPrepHex, btcNetwork),
    );
  }

  const signedSwapPsbt = progress.runSync("signSwapPsbt", () =>
    signer.signPsbtHex(quote.swapPsbt, quote.swapInputsToSign),
  );

  let feePayment: { psbtHex: string; feePaymentId: string } | undefined;
  if (quote.feePsbt && quote.feePaymentId) {
    const signedFeePsbt = progress.runSync("signFeePsbt", () =>
      signer.signPsbtHex(quote.feePsbt!, quote.feeInputsToSign),
    );
    feePayment = {
      psbtHex: signedFeePsbt,
      feePaymentId: quote.feePaymentId,
    };
  }

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
    zeldPayment: prep?.zeldPayment,
    fundingTxHex: prep?.fundingTxHex,
    revealTxHex: prep?.revealTxHex,
  };

  const result = await progress.runAsync("createSwap", () =>
    createSwap(http, createReq),
  );

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
