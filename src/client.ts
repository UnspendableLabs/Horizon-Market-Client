import * as btc from "bitcoinjs-lib";
import { HttpClient } from "./api/http.js";
import {
  listSwaps as apiListSwaps,
  getSwap as apiGetSwap,
  getLockedAssetUtxoIds as apiGetLockedAssetUtxoIds,
  searchAssetNames as apiSearchAssetNames,
  getPendingPurchaseTxIds as apiGetPendingPurchaseTxIds,
  createSwap as apiCreateSwap,
  purchaseSwaps as apiPurchaseSwaps,
} from "./api/atomic-swaps.js";
import { requestSellQuote as apiRequestSellQuote } from "./api/sell-quotes.js";
import { requestBuyQuote as apiRequestBuyQuote } from "./api/buy-quotes.js";
import { requestFeeQuote as apiRequestFeeQuote, type FeeQuoteParams } from "./api/fee-quotes.js";
import { startDelist as apiStartDelist, confirmDelist as apiConfirmDelist } from "./api/delist.js";
import { LocalSigner, type Signer } from "./crypto/signer.js";
import { openSellOrder as workflowOpenSellOrder, type OpenSellOrderParams } from "./workflows/sell.js";
import { fillSwaps as workflowFillSwaps, type FillSwapsParams } from "./workflows/buy.js";
import { delistSwap as workflowDelistSwap } from "./workflows/delist.js";
import type { HorizonMarketClientOptions } from "./config.js";
import { DEFAULT_BASE_URL } from "./config.js";
import type {
  AtomicSwap,
  AtomicSwapCreateRequest,
  AssetNameSearchResult,
  BuyQuote,
  BuyQuoteParams,
  ConfirmDelistResult,
  CreateSwapResult,
  DelistRequest,
  FeeQuoteBtc,
  FeeQuoteZeldTransferPrep,
  ListSwapsParams,
  ListSwapsResult,
  LockedAssetUtxoIds,
  PendingSale,
  SellQuote,
  SellQuoteParams,
} from "./types/index.js";

export type { OpenSellOrderParams } from "./workflows/sell.js";
export type { FillSwapsParams } from "./workflows/buy.js";

/**
 * HorizonMarketClient — entry point for the Horizon Market Atomic Swap API.
 *
 * Initialize with a private key or a custom Signer:
 * ```ts
 * const client = new HorizonMarketClient({ privateKey: "...", network: "mainnet" });
 * ```
 */
export class HorizonMarketClient {
  private readonly http: HttpClient;
  private readonly signer: Signer;
  private readonly network: "mainnet" | "testnet";
  private readonly btcNetwork: btc.Network;

  constructor(options: HorizonMarketClientOptions = {}) {
    this.network = options.network ?? "mainnet";
    this.btcNetwork =
      this.network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;

    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
    });

    if (options.signer) {
      this.signer = options.signer;
    } else if (options.privateKey) {
      this.signer = new LocalSigner(options.privateKey, this.network);
    } else {
      throw new Error(
        "HorizonMarketClient requires either `privateKey` or `signer`",
      );
    }
  }

  // ─── REST helpers ───────────────────────────────────────────────────────────

  /** List and filter atomic swaps. */
  listSwaps(params?: ListSwapsParams): Promise<ListSwapsResult> {
    return apiListSwaps(this.http, params ?? {});
  }

  /** Get a single atomic swap by id. */
  getSwap(id: string): Promise<AtomicSwap> {
    return apiGetSwap(this.http, id);
  }

  /**
   * Get locked asset UTXO ids for a seller address.
   * Use this to avoid double-listing or spending UTXOs already in active listings.
   */
  getLockedAssetUtxoIds(
    params?: { sellerAddress?: string; sellerAddresses?: string[] },
  ): Promise<LockedAssetUtxoIds> {
    return apiGetLockedAssetUtxoIds(this.http, params ?? {});
  }

  /** Search distinct listed asset names. */
  searchAssetNames(params?: {
    query?: string;
    filled?: boolean;
    limit?: number;
  }): Promise<AssetNameSearchResult> {
    return apiSearchAssetNames(this.http, params ?? {});
  }

  /** Poll in-flight purchase tx ids after fillSwaps. */
  getPendingPurchaseTxIds(swapId: string, address: string): Promise<string[]> {
    return apiGetPendingPurchaseTxIds(this.http, swapId, address);
  }

  /** Request a sell quote (server composes all unsigned PSBTs). */
  requestSellQuote(params: SellQuoteParams): Promise<SellQuote> {
    return apiRequestSellQuote(this.http, params);
  }

  /** Request a buy quote (server composes the unsigned buyer PSBT). */
  requestBuyQuote(params: BuyQuoteParams): Promise<BuyQuote> {
    return apiRequestBuyQuote(this.http, params);
  }

  /** Request a fee quote (advanced — for custom fee-quote flows). */
  requestFeeQuote(
    params: FeeQuoteParams,
  ): Promise<FeeQuoteBtc | FeeQuoteZeldTransferPrep> {
    return apiRequestFeeQuote(this.http, params);
  }

  /**
   * Submit a signed swap listing.
   *
   * Prefer `openSellOrder` for the full workflow. Use this for manual quote → sign → submit.
   */
  createSwap(req: AtomicSwapCreateRequest): Promise<CreateSwapResult> {
    return apiCreateSwap(this.http, req);
  }

  /**
   * Submit signed purchase PSBTs.
   *
   * Prefer `fillSwaps` for the full workflow. Use this for manual quote → sign → submit.
   * Note: NOT idempotent — do not retry on network errors.
   */
  purchaseSwaps(params: {
    swapIds: string[];
    buyerAddress: string;
    psbtHex: string;
  }): Promise<PendingSale[]> {
    return apiPurchaseSwaps(this.http, params);
  }

  /** Start a delist flow — returns the delist request. */
  startDelist(swapId: string): Promise<DelistRequest> {
    return apiStartDelist(this.http, swapId);
  }

  /** Confirm delist with a BIP322 signature over the delist request id. */
  confirmDelist(
    requestId: string,
    signature: string,
  ): Promise<ConfirmDelistResult> {
    return apiConfirmDelist(this.http, requestId, signature);
  }

  // ─── Workflow methods ────────────────────────────────────────────────────────

  /**
   * Open a sell order: sell-quote → sign → create listing.
   *
   * Returns `{ swap, created }` where `created: true` on 201 (new listing),
   * `created: false` when ZELD idempotency returns 200 with an existing open listing.
   */
  openSellOrder(
    params: OpenSellOrderParams,
  ): Promise<{ swap: AtomicSwap; created: boolean }> {
    return workflowOpenSellOrder(
      params,
      this.http,
      this.signer,
      this.network,
      this.btcNetwork,
    );
  }

  /**
   * Fill (purchase) one or more swap listings: buy-quote → sign → purchase.
   *
   * Returns an array of pending sales. Poll `getPendingPurchaseTxIds` for confirmation.
   * Note: purchases are NOT idempotent — do not retry on network errors.
   */
  fillSwaps(params: FillSwapsParams): Promise<PendingSale[]> {
    return workflowFillSwaps(params, this.http, this.signer);
  }

  /**
   * Delist a swap: start → sign (BIP322) → confirm.
   */
  delistSwap(swapId: string): Promise<void> {
    return workflowDelistSwap(swapId, this.http, this.signer);
  }
}
