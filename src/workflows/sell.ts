import type { HttpClient } from "../api/http.js";
import { requestSellQuote } from "../api/sell-quotes.js";
import { createSwap } from "../api/atomic-swaps.js";
import type { Signer } from "../crypto/signer.js";
import { buildSellPrepResult, type SignedSellPrepResult } from "./sell-prep.js";
import { WorkflowProgressReporter } from "./progress.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  FeePayment,
  ListingType,
  WorkflowOptions,
} from "../types/index.js";
import type { KontorSellParams } from "./sell-kontor.js";
import {
  assertOrdinalSellerAddress,
  assertSellListingParams,
  assertTaprootSellerPubkey,
  assertZeldMainnet,
  resolveSellerPubkey,
} from "../sell-params.js";
import * as btc from "bitcoinjs-lib";

/** Sell params for the PSBT asset types (counterparty / ordinal / zeld). */
export interface PsbtSellOrderParams {
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
  listingType: Exclude<ListingType, "kontor">;
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
 * Parameters for `openSellOrder`. Discriminated on `listingType`: pass
 * `listingType: "kontor"` with {@link KontorSellParams} for KOR/NFT, or one of
 * counterparty/ordinal/zeld with {@link PsbtSellOrderParams}.
 */
export type OpenSellOrderParams = PsbtSellOrderParams | KontorSellParams;

/** Kind of on-chain transaction a sell listing broadcast. */
export type SellBroadcastTxKind = "asset" | "fee";

/**
 * An on-chain transaction broadcast while opening a sell listing. Callers surface
 * a mempool link per entry; an empty list means the listing opened with no new
 * transaction (an existing UTXO reused, fee waived by a credit).
 */
export interface SellBroadcastTx {
  /** Bitcoin txid. */
  txid: string;
  /**
   * `"asset"` — the attach/reveal (counterparty), transfer (zeld) or attach
   * reveal (Kontor) that funds the listing's asset UTXO.
   * `"fee"` — a standalone platform-fee payment tx.
   */
  kind: SellBroadcastTxKind;
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
  params: PsbtSellOrderParams,
  http: HttpClient,
  signer: Signer,
  network: "mainnet" | "testnet",
  btcNetwork: btc.Network,
  options?: WorkflowOptions,
): Promise<{
  swap: AtomicSwap;
  created: boolean;
  transactions: SellBroadcastTx[];
}> {
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
    // `runAsync` (not `runSync`): the signer may sign asynchronously — an
    // external wallet prompts through a popup — so its result is awaited.
    const signedPrepHex = await progress.runAsync("signPrepPsbt", () =>
      Promise.resolve(
        signer.signPsbtHex(quote.prepPsbt!, quote.prepInputsToSign),
      ),
    );
    prep = progress.runSync("finalizePrepPsbt", () =>
      buildSellPrepResult(quote, signedPrepHex, btcNetwork),
    );
  }

  const signedSwapPsbt = await progress.runAsync("signSwapPsbt", () =>
    Promise.resolve(signer.signPsbtHex(quote.swapPsbt, quote.swapInputsToSign)),
  );

  let feePayment: FeePayment | undefined;
  if (quote.feePsbt && quote.feePaymentId) {
    // Separate platform-fee PSBT (existing-UTXO counterparty/ordinal, zeld existing UTXO).
    const signedFeePsbt = await progress.runAsync("signFeePsbt", () =>
      Promise.resolve(signer.signPsbtHex(quote.feePsbt!, quote.feeInputsToSign)),
    );
    feePayment = {
      psbtHex: signedFeePsbt,
      feePaymentId: quote.feePaymentId,
    };
  } else if (
    quote.prepKind === "attach" &&
    !quote.feeWaived &&
    quote.feePaymentId
  ) {
    // Folded fee: the platform-fee output rides inside the attach prep tx (sent
    // as funding_tx_hex), so there is no separate fee PSBT to sign — submit the
    // payment id alone. Required for anonymous listings (server rejects an
    // anonymous create with neither fee_payment nor zeld_payment).
    feePayment = { feePaymentId: quote.feePaymentId };
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

  // On-chain transactions this listing broadcast, so callers can surface a
  // mempool link per tx. A prep PSBT means a NEW asset UTXO tx was broadcast
  // (counterparty attach/reveal or zeld transfer); its txid is the asset UTXO's.
  // A separate fee PSBT (feePayment.psbtHex — not the folded-fee id-only branch)
  // is broadcast by the server, which returns its txid on the swap. A listing
  // that reused an existing UTXO with the fee waived (credit) broadcasts neither,
  // so the array is empty and the listing is live immediately.
  const transactions: SellBroadcastTx[] = [];
  if (quote.prepPsbt) {
    const assetTxId = quote.assetUtxoId.split(":")[0];
    if (assetTxId) transactions.push({ txid: assetTxId, kind: "asset" });
  }
  if (feePayment?.psbtHex) {
    const feeTxId = result.swap.onChainPayment?.txid;
    if (feeTxId && !transactions.some((t) => t.txid === feeTxId)) {
      transactions.push({ txid: feeTxId, kind: "fee" });
    }
  }

  return {
    swap: result.swap,
    created: result.created,
    transactions,
  };
}

function resolveSellerAddress(
  params: PsbtSellOrderParams,
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
