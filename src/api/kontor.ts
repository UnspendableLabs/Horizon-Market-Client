import type { HttpClient } from "./http.js";
import { mapAtomicSwap, type WireAtomicSwap } from "./atomic-swaps.js";
import type {
  CreateSwapResult,
  KontorAssetKind,
  PendingSale,
  RequestOptions,
} from "../types/index.js";

/**
 * Reserved Kontor listing fee.
 *
 * Normally paid as an extra output on the attach reveal. When the authenticated
 * account holds a credit / subscription the server waives it (`feeWaived: true`,
 * `paymentAmount: 0`, null address/id) — the SDK then skips the fee output and the
 * listing POST decrements a credit instead, exactly like PSBT listings.
 */
export interface KontorFeeQuote {
  feePaymentId: string | null;
  paymentAddress: string | null;
  paymentAmount: number;
  /** True when the fee is covered by an account credit / subscription. */
  feeWaived: boolean;
}

/** snake_case wire shape returned by the public `fee-quotes` endpoint. */
interface WireKontorFeeQuote {
  fee_payment_id: string | null;
  payment_address: string | null;
  payment_amount: number;
  fee_waived?: boolean;
}

/**
 * POST /api/atomic-swaps/fee-quotes — reserve a Kontor listing fee.
 *
 * Returns `{ fee_payment_id, payment_address, payment_amount, fee_waived }`
 * (snake_case, no PSBT — the Kontor branch of the public fee-quote endpoint); the
 * SDK settles the fee as an extra output on the attach reveal it broadcasts. When
 * `fee_waived` is true (account credit / subscription) no payment is reserved and
 * the SDK omits the fee output. Sends only the seller's address (public), but the
 * request is authenticated so the server can decide whether to waive the fee.
 */
export async function createKontorFeeQuote(
  http: HttpClient,
  address: string,
  options?: RequestOptions,
): Promise<KontorFeeQuote> {
  const wire = await http.request<WireKontorFeeQuote>(
    "POST",
    "/api/atomic-swaps/fee-quotes",
    { type: "kontor", address },
    options?.signal,
  );
  return {
    feePaymentId: wire.fee_payment_id,
    paymentAddress: wire.payment_address,
    paymentAmount: wire.payment_amount,
    feeWaived: wire.fee_waived ?? false,
  };
}

/** Side-effect-free Kontor listing-fee preview (see {@link previewKontorListingFee}). */
export interface KontorListingFeePreview {
  /** Platform listing fee in sats (0 when waived). */
  sats: number;
  /** True when the fee is covered by an account credit / subscription. */
  feeWaived: boolean;
}

/**
 * POST /api/atomic-swaps/fee-quotes with `preview: true` — read the Kontor
 * listing fee (sats) WITHOUT reserving an OnChainPayment. The platform fee is a
 * fixed USD amount priced in sats at the current BTC rate; this mirrors the
 * `sell-quotes` `preview` mode for PSBT listings. When the authenticated account
 * holds a credit / subscription the server returns `feeWaived: true` / `sats: 0`.
 * The result is for display only — call {@link createKontorFeeQuote} to reserve.
 */
export async function previewKontorListingFee(
  http: HttpClient,
  address: string,
  options?: RequestOptions,
): Promise<KontorListingFeePreview> {
  const wire = await http.request<{
    payment_amount: number;
    fee_waived?: boolean;
  }>(
    "POST",
    "/api/atomic-swaps/fee-quotes",
    { type: "kontor", address, preview: true },
    options?.signal,
  );
  return {
    sats: wire.payment_amount,
    feeWaived: wire.fee_waived ?? false,
  };
}

/** Input for {@link createKontorSwap}. */
export interface KontorCreateSwapRequest {
  /** `${attachRevealTxid}:0`. */
  assetUtxoId: string;
  /** Value (sats) of the escrow output (output 0 of the attach reveal). */
  assetUtxoValue: number;
  /** Net sats the seller receives. */
  price: number;
  /** Seller taproot (P2TR) address. */
  sellerAddress: string;
  /** Serialized Kontor OfferData blob. */
  kontorOfferBlob: string;
  kontorAssetKind: KontorAssetKind;
  /** Contract address (`name@height.txIndex`). */
  kontorContractAddress: string;
  /** NFT id (nft only). */
  kontorNftId?: string | null;
  /** KOR amount as a decimal string (token only). */
  kontorAmount?: string | null;
  /** Reserved fee payment id from {@link createKontorFeeQuote}. */
  feePaymentId?: string;
}

interface WireKontorCreateBody {
  asset_utxo_id: string;
  asset_utxo_value: number;
  price: number;
  seller_address: string;
  listing_type: "kontor";
  kontor_offer_blob: string;
  kontor_asset_kind: KontorAssetKind;
  kontor_contract_address: string;
  kontor_nft_id?: string | null;
  kontor_amount?: string | null;
  fee_payment?: { fee_payment_id: string };
}

/**
 * POST /api/atomic-swaps — create a Kontor listing (flat public body, no PSBT).
 *
 * The body carries only the signed offer blob and bookkeeping fields — never a key.
 */
export async function createKontorSwap(
  http: HttpClient,
  req: KontorCreateSwapRequest,
  options?: RequestOptions,
): Promise<CreateSwapResult> {
  const body: WireKontorCreateBody = {
    asset_utxo_id: req.assetUtxoId,
    asset_utxo_value: req.assetUtxoValue,
    price: req.price,
    seller_address: req.sellerAddress,
    listing_type: "kontor",
    kontor_offer_blob: req.kontorOfferBlob,
    kontor_asset_kind: req.kontorAssetKind,
    kontor_contract_address: req.kontorContractAddress,
    kontor_nft_id: req.kontorNftId ?? null,
    kontor_amount: req.kontorAmount ?? null,
  };
  if (req.feePaymentId !== undefined) {
    body.fee_payment = { fee_payment_id: req.feePaymentId };
  }

  const { data: wire, status } = await http.requestRaw<WireAtomicSwap>(
    "POST",
    "/api/atomic-swaps",
    body,
    options?.signal,
  );

  return {
    swap: mapAtomicSwap(wire),
    status: status as 200 | 201,
    created: status === 201,
  };
}

/**
 * POST /api/atomic-swaps/{id}/kontor-buy — record a completed Kontor swap.
 *
 * The buyer has already broadcast the swap reveal via the SDK's `accept()`; this
 * records the `buyer_address` and swap-reveal `tx_id` server-side.
 */
export async function kontorBuy(
  http: HttpClient,
  swapId: string,
  params: { buyerAddress: string; txId: string },
  options?: RequestOptions,
): Promise<PendingSale> {
  await http.request<unknown>(
    "POST",
    `/api/atomic-swaps/${swapId}/kontor-buy`,
    { buyer_address: params.buyerAddress, tx_id: params.txId },
    options?.signal,
  );

  return {
    txId: params.txId,
    buyerAddress: params.buyerAddress,
    atomicSwap: { id: swapId },
  };
}
