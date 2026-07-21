import type { HttpClient } from "./http.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  CreateSwapResult,
  ListSwapsParams,
  ListSwapsResult,
  LockedAssetUtxoIds,
  AssetNameSearchResult,
  OnChainPayment,
  Pagination,
  PendingSale,
  ListingType,
  KontorAssetKind,
  RequestOptions,
  SwapFacets,
  SwapFacetsParams,
  PriceBucketFacet,
  CollectionFacet,
} from "../types/index.js";
import { serializeAssetQuantity } from "../utils.js";

// ─── Wire types (snake_case, internal only) ──────────────────────────────────

interface WireOnChainPayment {
  id: string;
  confirmed: boolean;
  txid: string | null;
  sats?: number;
  to_address?: string;
}

export interface WireAtomicSwap {
  id: string;
  listing_type: ListingType;
  seller_address: string;
  buyer_address: string | null;
  asset_utxo_id: string | null;
  asset_utxo_value: number | null;
  asset_name: string | null;
  /**
   * Counterparty subasset long name (e.g. "PEPENARDO.CARD") resolved server-side,
   * or `null` when the asset has none. Absent on endpoints/fixtures that don't
   * resolve it. See {@link AtomicSwap.assetLongname}.
   */
  asset_longname?: string | null;
  asset_quantity: number | string | null;
  price: number;
  price_per_unit: number | null;
  psbt_hex: string | null;
  tx_id: string | null;
  block_index: number | null;
  funded: boolean;
  filled: boolean;
  confirmed: boolean;
  delisted: boolean;
  seller_delisted: boolean;
  expired: boolean;
  pending: boolean;
  anomalous: boolean;
  royalty: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  on_chain_payment: WireOnChainPayment | null;
  user?: { id: string } | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  inscription_number?: number | null;
  asset_divisibility?: boolean | null;
  kontor_offer_blob?: string | null;
  kontor_asset_kind?: KontorAssetKind | null;
  kontor_contract_address?: string | null;
  kontor_nft_id?: string | null;
  kontor_amount?: string | null;
  /** Only present on the list endpoint when `pending_address` was supplied. */
  pending_role?: "seller" | "buyer" | null;
  /** Only present on the list endpoint when `pending_address` was supplied. */
  pending_txid?: string | null;
}

interface WirePagination {
  total: number;
  offset: number;
  limit: number | null;
}

interface WireListSwapsResult {
  count: number;
  atomic_swaps: WireAtomicSwap[];
  pagination: WirePagination;
}

interface WirePriceBucketFacet {
  id: string;
  label: string;
  min_sats: number | null;
  max_sats: number | null;
  count: number;
}

interface WireCollectionFacet {
  slug: string;
  name: string;
  count: number;
}

interface WireSwapFacets {
  type: Record<ListingType, number>;
  price: WirePriceBucketFacet[];
  collection: WireCollectionFacet[];
}

interface WireAssetNameSearchResult {
  asset_names: string[];
  asset_media: Record<string, unknown>;
}

interface WirePendingSale {
  tx_id: string;
  buyer_address: string;
  atomic_swap: { id: string };
}

interface WireAtomicSwapCreateBody {
  asset_utxo_id: string;
  asset_utxo_value: number;
  price: number;
  seller_address: string;
  psbt_hex: string;
  listing_type?: ListingType;
  asset_name?: string | null;
  asset_quantity?: number | string | null;
  expires_at?: string | null;
  fee_payment?:
    | { psbt_hex: string; fee_payment_id: string }
    | { fee_payment_id: string };
  zeld_payment?: {
    zeld_send_txid: string;
    zeld_send_tx_hex: string;
    fee_payment_id: string;
  };
  funding_tx_hex?: string;
  reveal_tx_hex?: string;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapOnChainPayment(wire: WireOnChainPayment): OnChainPayment {
  return {
    id: wire.id,
    confirmed: wire.confirmed,
    txid: wire.txid,
    sats: wire.sats,
    toAddress: wire.to_address,
  };
}

function mapPagination(wire: WirePagination): Pagination {
  return {
    total: wire.total,
    offset: wire.offset,
    limit: wire.limit,
  };
}

export function mapAtomicSwap(wire: WireAtomicSwap): AtomicSwap {
  let assetQuantity: bigint | null = null;
  if (wire.asset_quantity !== null && wire.asset_quantity !== undefined) {
    assetQuantity = BigInt(wire.asset_quantity);
  }

  return {
    id: wire.id,
    listingType: wire.listing_type,
    sellerAddress: wire.seller_address,
    buyerAddress: wire.buyer_address,
    assetUtxoId: wire.asset_utxo_id,
    assetUtxoValue: wire.asset_utxo_value,
    assetName: wire.asset_name,
    assetLongname: wire.asset_longname ?? null,
    assetQuantity,
    price: wire.price,
    pricePerUnit: wire.price_per_unit,
    psbtHex: wire.psbt_hex,
    txId: wire.tx_id,
    blockIndex: wire.block_index,
    funded: wire.funded,
    filled: wire.filled,
    confirmed: wire.confirmed,
    delisted: wire.delisted,
    sellerDelisted: wire.seller_delisted,
    expired: wire.expired,
    pending: wire.pending,
    anomalous: wire.anomalous,
    royalty: wire.royalty,
    expiresAt: wire.expires_at,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    onChainPayment: wire.on_chain_payment
      ? mapOnChainPayment(wire.on_chain_payment)
      : null,
    user: wire.user ?? undefined,
    imageUrl: wire.image_url ?? null,
    thumbnailUrl: wire.thumbnail_url ?? null,
    inscriptionNumber: wire.inscription_number ?? null,
    assetDivisibility: wire.asset_divisibility ?? null,
    kontorOfferBlob: wire.kontor_offer_blob ?? null,
    kontorAssetKind: wire.kontor_asset_kind ?? null,
    kontorContractAddress: wire.kontor_contract_address ?? null,
    kontorNftId: wire.kontor_nft_id ?? null,
    kontorAmount: wire.kontor_amount ?? null,
    pendingRole: wire.pending_role ?? null,
    pendingTxid: wire.pending_txid ?? null,
  };
}

// ─── API functions ────────────────────────────────────────────────────────────

function mapPriceBucketFacet(wire: WirePriceBucketFacet): PriceBucketFacet {
  return {
    id: wire.id,
    label: wire.label,
    minSats: wire.min_sats,
    maxSats: wire.max_sats,
    count: wire.count,
  };
}

function mapCollectionFacet(wire: WireCollectionFacet): CollectionFacet {
  return { slug: wire.slug, name: wire.name, count: wire.count };
}

/**
 * Append the filter params shared by `listSwaps` and `getSwapFacets` to a query
 * string (everything that narrows the result set — not pagination, sort, or the
 * address-scoping params that only `listSwaps` understands).
 */
function appendSwapFilterParams(
  qs: URLSearchParams,
  params: ListSwapsParams | SwapFacetsParams,
): void {
  if (params.search !== undefined) qs.set("search", params.search);
  if (params.listingType !== undefined)
    qs.set("listing_type", params.listingType);
  if (params.priceMin !== undefined)
    qs.set("price_min", params.priceMin.toString());
  if (params.priceMax !== undefined)
    qs.set("price_max", params.priceMax.toString());
  if (params.collection !== undefined) qs.set("collection", params.collection);
  if (params.funded !== undefined)
    qs.set("funded", params.funded ? "true" : "false");
  if (params.filled !== undefined)
    qs.set("filled", params.filled ? "true" : "false");
  if (params.delisted !== undefined)
    qs.set("delisted", params.delisted ? "true" : "false");
  if (params.unattached !== undefined)
    qs.set("unattached", params.unattached ? "true" : "false");
  if (params.sales !== undefined)
    qs.set("sales", params.sales ? "true" : "false");
}

export async function listSwaps(
  http: HttpClient,
  params: ListSwapsParams = {},
  options?: RequestOptions,
): Promise<ListSwapsResult> {
  const qs = new URLSearchParams();
  if (params.assetName !== undefined) qs.set("asset_name", params.assetName);
  if (params.sellerAddress !== undefined)
    qs.set("seller_address", params.sellerAddress);
  if (params.buyerAddress !== undefined)
    qs.set("buyer_address", params.buyerAddress);
  if (params.pendingAddress !== undefined) {
    // The API accepts a comma-separated list; an order matching any address is
    // prioritized. Sending all of a wallet's addresses in one query avoids the
    // per-address fan-out.
    const pendingAddresses = Array.isArray(params.pendingAddress)
      ? params.pendingAddress
      : [params.pendingAddress];
    if (pendingAddresses.length > 0)
      qs.set("pending_address", pendingAddresses.join(","));
  }
  appendSwapFilterParams(qs, params);
  if (params.order !== undefined) qs.set("order", params.order);
  if (params.orderBy !== undefined) qs.set("order_by", params.orderBy);
  if (params.offset !== undefined)
    qs.set("offset", params.offset.toString());
  if (params.limit !== undefined) qs.set("limit", params.limit.toString());

  const query = qs.toString();
  const path = query
    ? `/api/atomic-swaps?${query}`
    : "/api/atomic-swaps";

  const wire = await http.request<WireListSwapsResult>(
    "GET",
    path,
    undefined,
    options?.signal,
  );

  return {
    count: wire.count,
    atomicSwaps: wire.atomic_swaps.map(mapAtomicSwap),
    pagination: mapPagination(wire.pagination),
  };
}

export async function getSwapFacets(
  http: HttpClient,
  params: SwapFacetsParams = {},
  options?: RequestOptions,
): Promise<SwapFacets> {
  const qs = new URLSearchParams();
  appendSwapFilterParams(qs, params);

  const query = qs.toString();
  const path = query
    ? `/api/atomic-swaps/facets?${query}`
    : "/api/atomic-swaps/facets";

  const wire = await http.request<WireSwapFacets>(
    "GET",
    path,
    undefined,
    options?.signal,
  );

  return {
    type: wire.type,
    price: wire.price.map(mapPriceBucketFacet),
    collection: wire.collection.map(mapCollectionFacet),
  };
}

export async function getSwap(
  http: HttpClient,
  id: string,
  options?: RequestOptions,
): Promise<AtomicSwap> {
  const wire = await http.request<WireAtomicSwap>(
    "GET",
    `/api/atomic-swaps/${id}`,
    undefined,
    options?.signal,
  );
  return mapAtomicSwap(wire);
}

export async function getLockedAssetUtxoIds(
  http: HttpClient,
  params: { sellerAddress?: string; sellerAddresses?: string[] } = {},
  options?: RequestOptions,
): Promise<LockedAssetUtxoIds> {
  const qs = new URLSearchParams();
  if (params.sellerAddress !== undefined)
    qs.set("seller_address", params.sellerAddress);
  if (params.sellerAddresses !== undefined && params.sellerAddresses.length > 0)
    qs.set("seller_addresses", params.sellerAddresses.join(","));

  const query = qs.toString();
  const path = query
    ? `/api/atomic-swaps/asset-utxo-id?${query}`
    : "/api/atomic-swaps/asset-utxo-id";

  return http.request<LockedAssetUtxoIds>(
    "GET",
    path,
    undefined,
    options?.signal,
  );
}

export async function searchAssetNames(
  http: HttpClient,
  params: { query?: string; filled?: boolean; limit?: number } = {},
  options?: RequestOptions,
): Promise<AssetNameSearchResult> {
  const qs = new URLSearchParams();
  if (params.query !== undefined) qs.set("query", params.query);
  if (params.filled !== undefined)
    qs.set("filled", params.filled ? "true" : "false");
  if (params.limit !== undefined) qs.set("limit", params.limit.toString());

  const query = qs.toString();
  const path = query
    ? `/api/atomic-swaps/asset-name?${query}`
    : "/api/atomic-swaps/asset-name";

  const wire = await http.request<WireAssetNameSearchResult>(
    "GET",
    path,
    undefined,
    options?.signal,
  );

  return {
    assetNames: wire.asset_names,
    assetMedia: wire.asset_media,
  };
}

export async function getPendingPurchaseTxIds(
  http: HttpClient,
  id: string,
  address: string,
  options?: RequestOptions,
): Promise<string[]> {
  return http.request<string[]>(
    "GET",
    `/api/atomic-swaps/${id}/pending-sales/${address}`,
    undefined,
    options?.signal,
  );
}

export async function createSwap(
  http: HttpClient,
  req: AtomicSwapCreateRequest,
  options?: RequestOptions,
): Promise<CreateSwapResult> {
  const body: WireAtomicSwapCreateBody = {
    asset_utxo_id: req.assetUtxoId,
    asset_utxo_value: req.assetUtxoValue,
    price: req.price,
    seller_address: req.sellerAddress,
    psbt_hex: req.psbtHex,
  };

  if (req.listingType !== undefined) body.listing_type = req.listingType;
  if (req.assetName !== undefined) body.asset_name = req.assetName;
  if (req.assetQuantity !== undefined) {
    body.asset_quantity = serializeAssetQuantity(req.assetQuantity);
  }
  if (req.expiresAt !== undefined) body.expires_at = req.expiresAt;
  if (req.feePayment !== undefined) {
    // Counterparty attach folded-fee listings send the id alone (no PSBT); the
    // server maps a psbt-less fee_payment to the folded-fee create path.
    body.fee_payment =
      req.feePayment.psbtHex === undefined
        ? { fee_payment_id: req.feePayment.feePaymentId }
        : {
            psbt_hex: req.feePayment.psbtHex,
            fee_payment_id: req.feePayment.feePaymentId,
          };
  }
  if (req.zeldPayment !== undefined) {
    body.zeld_payment = {
      zeld_send_txid: req.zeldPayment.zeldSendTxId,
      zeld_send_tx_hex: req.zeldPayment.zeldSendTxHex,
      fee_payment_id: req.zeldPayment.feePaymentId,
    };
  }
  if (req.fundingTxHex !== undefined) body.funding_tx_hex = req.fundingTxHex;
  if (req.revealTxHex !== undefined) body.reveal_tx_hex = req.revealTxHex;

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

export async function purchaseSwaps(
  http: HttpClient,
  params: { swapIds: string[]; buyerAddress: string; psbtHex: string },
  options?: RequestOptions,
): Promise<PendingSale[]> {
  const wire = await http.request<WirePendingSale[]>(
    "POST",
    "/api/atomic-swaps/purchases",
    {
      swap_ids: params.swapIds,
      buyer_address: params.buyerAddress,
      psbt_hex: params.psbtHex,
    },
    options?.signal,
  );

  return wire.map((w) => ({
    txId: w.tx_id,
    buyerAddress: w.buyer_address,
    atomicSwap: { id: w.atomic_swap.id },
  }));
}
