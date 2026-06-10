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
import {
  openSellOrder as workflowOpenSellOrder,
  type OpenSellOrderParams,
  type PsbtSellOrderParams,
} from "./workflows/sell.js";
import { fillSwaps as workflowFillSwaps, type FillSwapsParams } from "./workflows/buy.js";
import { delistSwap as workflowDelistSwap } from "./workflows/delist.js";
import { openKontorSellOrder } from "./workflows/sell-kontor.js";
import { fillKontorSwap } from "./workflows/buy-kontor.js";
import { delistKontorSwap } from "./workflows/delist-kontor.js";
import { resolveKontorChain } from "./kontor/chain.js";
import type { KontorContext } from "./kontor/context.js";
import type { HorizonMarketClientOptions } from "./config.js";
import { DEFAULT_BASE_URL, DEFAULT_KONTOR_INDEXER_URL } from "./config.js";
import {
  assertNonEmptySwapIds,
  assertBuyQuoteParams,
  assertP2WpkhBuyerAddress,
} from "./buy-params.js";
import {
  assertOrdinalSellerAddress,
  assertSellListingParams,
  assertTaprootSellerPubkey,
  assertZeldMainnet,
  resolveSellerPubkey,
} from "./sell-params.js";
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
  RequestOptions,
  SellQuote,
  SellQuoteParams,
  KontorFunding,
  WorkflowOptions,
} from "./types/index.js";

export type { OpenSellOrderParams } from "./workflows/sell.js";
export type { FillSwapsParams } from "./workflows/buy.js";

/** Options for `delistSwap`. Kontor delists may carry `fundingUtxos` for the on-chain revoke. */
export interface DelistSwapOptions extends WorkflowOptions {
  /** Funding UTXOs for the on-chain revoke (Kontor only). Omitted = auto-fetch. */
  fundingUtxos?: KontorFunding;
}

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
  private readonly signer: Signer | null;
  private readonly network: "mainnet" | "testnet";
  private readonly btcNetwork: btc.Network;
  private readonly kontorNetwork?: "signet";
  private readonly kontorIndexerUrl: string;

  constructor(options: HorizonMarketClientOptions = {}) {
    this.network = options.network ?? "mainnet";
    this.btcNetwork =
      this.network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
    this.kontorNetwork = options.kontorNetwork;
    this.kontorIndexerUrl =
      options.kontorIndexerUrl ?? DEFAULT_KONTOR_INDEXER_URL;

    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
    });

    if (options.signer) {
      this.signer = options.signer;
    } else if (options.privateKey) {
      this.signer = new LocalSigner(options.privateKey, this.network);
    } else {
      this.signer = null;
    }
  }

  private assertSigner(): Signer {
    if (!this.signer) {
      throw new Error(
        "This operation requires authentication. Provide a `privateKey` or `signer`.",
      );
    }
    return this.signer;
  }

  /**
   * Resolve the Kontor runtime context, or throw a clear error if Kontor is not
   * usable with the current configuration. Kontor is signet-only today, and
   * signet uses testnet address params, so the client `network` must be "testnet".
   */
  private resolveKontorCtx(): KontorContext {
    const chain = resolveKontorChain(this.kontorNetwork);
    if (!chain) {
      throw new Error(
        'Kontor is only available on signet today. Pass kontorNetwork: "signet" to the client.',
      );
    }
    if (this.network !== "testnet") {
      throw new Error(
        'Kontor (signet) requires the client network to be "testnet" so taproot ' +
          "addresses use signet/testnet params.",
      );
    }
    return {
      chain,
      indexerUrl: this.kontorIndexerUrl,
      btcNetwork: this.btcNetwork,
    };
  }

  // ─── REST helpers ───────────────────────────────────────────────────────────

  /** List and filter atomic swaps. */
  listSwaps(
    params?: ListSwapsParams,
    options?: RequestOptions,
  ): Promise<ListSwapsResult> {
    return apiListSwaps(this.http, params ?? {}, options);
  }

  /** Get a single atomic swap by id. */
  getSwap(id: string, options?: RequestOptions): Promise<AtomicSwap> {
    return apiGetSwap(this.http, id, options);
  }

  /**
   * Get locked asset UTXO ids for a seller address.
   * Use this to avoid double-listing or spending UTXOs already in active listings.
   */
  getLockedAssetUtxoIds(
    params?: { sellerAddress?: string; sellerAddresses?: string[] },
    options?: RequestOptions,
  ): Promise<LockedAssetUtxoIds> {
    return apiGetLockedAssetUtxoIds(this.http, params ?? {}, options);
  }

  /** Search distinct listed asset names. */
  searchAssetNames(
    params?: {
      query?: string;
      filled?: boolean;
      limit?: number;
    },
    options?: RequestOptions,
  ): Promise<AssetNameSearchResult> {
    return apiSearchAssetNames(this.http, params ?? {}, options);
  }

  /** Poll in-flight purchase tx ids after fillSwaps. */
  getPendingPurchaseTxIds(
    swapId: string,
    address: string,
    options?: RequestOptions,
  ): Promise<string[]> {
    return apiGetPendingPurchaseTxIds(this.http, swapId, address, options);
  }

  /** Request a sell quote (server composes all unsigned PSBTs). */
  requestSellQuote(
    params: SellQuoteParams,
    options?: RequestOptions,
  ): Promise<SellQuote> {
    const signer = this.assertSigner();
    assertZeldMainnet(params.listingType, this.network);
    assertSellListingParams(params);
    assertOrdinalSellerAddress(params.listingType, params.sellerAddress);
    const sellerPubkey = resolveSellerPubkey(
      params.sellerAddress,
      params.sellerPubkey,
      signer.getAddresses(),
    );
    assertTaprootSellerPubkey(params.sellerAddress, sellerPubkey);
    return apiRequestSellQuote(
      this.http,
      { ...params, sellerPubkey },
      options,
    );
  }

  /** Request a buy quote (server composes the unsigned buyer PSBT). */
  requestBuyQuote(
    params: BuyQuoteParams,
    options?: RequestOptions,
  ): Promise<BuyQuote> {
    assertBuyQuoteParams(params);
    return apiRequestBuyQuote(this.http, params, options);
  }

  /** Request a fee quote (advanced — for custom fee-quote flows). ZELD variant is mainnet only. */
  requestFeeQuote(
    params: FeeQuoteParams,
    options?: RequestOptions,
  ): Promise<FeeQuoteBtc | FeeQuoteZeldTransferPrep> {
    if ("type" in params && params.type === "zeld") {
      assertZeldMainnet("zeld", this.network);
    }
    return apiRequestFeeQuote(this.http, params, options);
  }

  /**
   * Submit a signed swap listing.
   *
   * Prefer `openSellOrder` for the full workflow. Use this for manual quote → sign → submit.
   *
   * ZELD listings (transfer prep and `zeld_payment` path): HTTP **201** → `created: true`;
   * HTTP **200** with identical `psbt_hex` / `price` / `asset_quantity` → `created: false`
   * (idempotent replay). HTTP **409** → `HorizonMarketApiError` (`Conflicting zeld listing`).
   * counterparty/ordinal creates are not idempotent — do not retry on network errors.
   */
  createSwap(
    req: AtomicSwapCreateRequest,
    options?: RequestOptions,
  ): Promise<CreateSwapResult> {
    return apiCreateSwap(this.http, req, options);
  }

  /**
   * Submit signed purchase PSBTs.
   *
   * Prefer `fillSwaps` for the full workflow. Use this for manual quote → sign → submit.
   * Note: NOT idempotent — do not retry on network errors.
   */
  purchaseSwaps(
    params: {
      swapIds: string[];
      buyerAddress: string;
      psbtHex: string;
    },
    options?: RequestOptions,
  ): Promise<PendingSale[]> {
    assertP2WpkhBuyerAddress(params.buyerAddress);
    return apiPurchaseSwaps(this.http, params, options);
  }

  /** Start a delist flow — returns the delist request. */
  startDelist(swapId: string, options?: RequestOptions): Promise<DelistRequest> {
    return apiStartDelist(this.http, swapId, options);
  }

  /** Confirm delist with a BIP322 signature over the delist request id. */
  confirmDelist(
    requestId: string,
    signature: string,
    options?: RequestOptions,
  ): Promise<ConfirmDelistResult> {
    return apiConfirmDelist(this.http, requestId, signature, options);
  }

  // ─── Workflow methods ────────────────────────────────────────────────────────

  /**
   * Open a sell order: sell-quote → sign → create listing.
   *
   * Returns `{ swap, created }` where `created: true` on HTTP 201 (new listing),
   * `created: false` when ZELD idempotency returns HTTP 200 with an existing open
   * listing (same `psbt_hex`, `price`, and `asset_quantity`).
   *
   * Throws `HorizonMarketApiError` with status **409** (`Conflicting zeld listing`)
   * when a conflicting open ZELD listing exists for the same seller UTXO.
   *
   * New attach-prep or zeld transfer-prep listings may be `funded: false` until the
   * prep tx confirms — poll `getSwap` before calling `fillSwaps`.
   */
  openSellOrder(
    params: OpenSellOrderParams,
    options?: WorkflowOptions,
  ): Promise<{ swap: AtomicSwap; created: boolean }> {
    if (params.listingType === "kontor") {
      return openKontorSellOrder(
        params,
        this.http,
        this.assertSigner(),
        this.resolveKontorCtx(),
        options,
      );
    }
    return workflowOpenSellOrder(
      params as PsbtSellOrderParams,
      this.http,
      this.assertSigner(),
      this.network,
      this.btcNetwork,
      options,
    );
  }

  /**
   * Fill (purchase) one or more swap listings: buy-quote → sign → purchase.
   *
   * Returns an array of pending sales. Poll `getPendingPurchaseTxIds` for confirmation.
   * Note: purchases are NOT idempotent — do not retry on network errors.
   */
  async fillSwaps(
    params: FillSwapsParams,
    options?: WorkflowOptions,
  ): Promise<PendingSale[]> {
    // Only probe the swap type when Kontor is configured — non-Kontor clients
    // keep the original single-round-trip behavior.
    if (this.kontorNetwork) {
      assertNonEmptySwapIds(params.swapIds);
      const first = await this.getSwap(params.swapIds[0]);
      if (first.listingType === "kontor") {
        if (params.swapIds.length !== 1) {
          throw new Error(
            "Kontor purchases must target exactly one swapId (got " +
              params.swapIds.length +
              ")",
          );
        }
        return fillKontorSwap(
          first,
          { kontorFundingUtxos: params.kontorFundingUtxos },
          this.http,
          this.assertSigner(),
          this.resolveKontorCtx(),
          options,
        );
      }
    }
    return workflowFillSwaps(params, this.http, this.assertSigner(), options);
  }

  /**
   * Delist a swap: start → sign (BIP322) → confirm.
   *
   * Kontor swaps additionally revoke the on-chain offer first to reclaim the
   * escrowed asset; pass `options.fundingUtxos` to fund that revoke (auto-fetched
   * otherwise).
   */
  async delistSwap(swapId: string, options?: DelistSwapOptions): Promise<void> {
    if (this.kontorNetwork) {
      const swap = await this.getSwap(swapId);
      if (swap.listingType === "kontor") {
        return delistKontorSwap(
          swap,
          { fundingUtxos: options?.fundingUtxos },
          this.http,
          this.assertSigner(),
          this.resolveKontorCtx(),
          options,
        );
      }
    }
    return workflowDelistSwap(swapId, this.http, this.assertSigner(), options);
  }
}
