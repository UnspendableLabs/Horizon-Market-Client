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
import {
  requestWalletChallenge as apiRequestWalletChallenge,
  completeWalletSignIn as apiCompleteWalletSignIn,
  getSession as apiGetSession,
  type SessionInfo,
} from "./api/auth.js";
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
import { makeKontorReadSession } from "./kontor/session.js";
import { bindKontorToken, bindKontorNft } from "./kontor/contracts.js";
import { holderCandidates } from "./kontor/holders.js";
import {
  getCounterpartyBalances as apiGetCounterpartyBalances,
  type CounterpartyBalance,
} from "./api/counterparty.js";
import { getZeldBalance as apiGetZeldBalance, type ZeldBalance } from "./api/zeld.js";
import { resolveFetch } from "./api/resolveFetch.js";
import type { HorizonMarketClientOptions } from "./config.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_KONTOR_INDEXER_URL,
  DEFAULT_COUNTERPARTY_API_BASE_URL,
  DEFAULT_ZELD_API_BASE_URL,
} from "./config.js";
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
export type { CounterpartyBalance } from "./api/counterparty.js";
export type { ZeldBalance } from "./api/zeld.js";

/** The connected wallet's KOR token balance (native Kontor token). */
export interface KontorBalance {
  /** KOR amount as a decimal string (e.g. "100.5"). "0" when none. */
  amount: string;
  /** The taproot address whose x-only key holds the balance. */
  address: string;
}

/** A single Kontor NFT owned by the connected wallet. */
export interface KontorNftHolding {
  nftId: string;
  /** NFT contract address (`name@height.txIndex`). */
  contractAddress: string;
  /** The taproot address whose x-only key holds the NFT. */
  address: string;
}

/** Result of `getKontorHoldings` — KOR balance + owned NFTs (empty when unset). */
export interface KontorHoldings {
  kor: KontorBalance | null;
  nfts: KontorNftHolding[];
}

// `list_nfts_by_holder` clamps `limit` to 100 per call; page with `offset` up to
// this many NFTs per holder candidate to bound the work.
const KONTOR_NFT_PAGE = 100n;
const KONTOR_NFT_MAX_PER_HOLDER = 1000n;

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
  private readonly kontorNftContractAddress?: string;
  private readonly counterpartyApiBaseUrl: string;
  private readonly zeldApiBaseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: HorizonMarketClientOptions = {}) {
    this.network = options.network ?? "mainnet";
    this.btcNetwork =
      this.network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
    this.kontorNetwork = options.kontorNetwork;
    this.kontorIndexerUrl =
      options.kontorIndexerUrl ?? DEFAULT_KONTOR_INDEXER_URL;
    this.kontorNftContractAddress = options.kontorNftContractAddress;
    this.counterpartyApiBaseUrl =
      options.counterpartyApiBaseUrl ?? DEFAULT_COUNTERPARTY_API_BASE_URL;
    this.zeldApiBaseUrl = options.zeldApiBaseUrl ?? DEFAULT_ZELD_API_BASE_URL;
    this.fetch = resolveFetch(options.fetch);

    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
    });

    if (options.sessionToken) {
      this.http.setSessionToken(options.sessionToken);
    }

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

  // ─── Owned-balance reads (public protocol APIs) ──────────────────────────────

  /**
   * Read the connected wallet's owned XCP + Counterparty asset balances across
   * the given `addresses` (e.g. P2WPKH + P2TR), each row tagged with its holding
   * address. Calls the public Counterparty API v2 directly via the client's
   * `fetch`. **Mainnet only** — returns `[]` on non-mainnet. Excludes ZELD (its
   * own protocol — see {@link getZeldBalances}).
   */
  async getCounterpartyBalances(
    addresses: string[],
  ): Promise<CounterpartyBalance[]> {
    if (this.network !== "mainnet") return [];
    const unique = [...new Set(addresses.filter(Boolean))];
    const perAddress = await Promise.all(
      unique.map((address) =>
        apiGetCounterpartyBalances(
          this.fetch,
          this.counterpartyApiBaseUrl,
          address,
        ),
      ),
    );
    return perAddress.flat();
  }

  /**
   * Read the connected wallet's ZELD balance across the given `addresses`, summed
   * per address. ZELD is its own protocol (not a Counterparty asset) and
   * **mainnet only** — returns `[]` on non-mainnet. Returns one entry per address
   * that holds ZELD (`balance > 0`).
   */
  async getZeldBalances(addresses: string[]): Promise<ZeldBalance[]> {
    if (this.network !== "mainnet") return [];
    const unique = [...new Set(addresses.filter(Boolean))];
    const results = await Promise.all(
      unique.map((address) =>
        apiGetZeldBalance(this.fetch, this.zeldApiBaseUrl, address),
      ),
    );
    return results.filter((b): b is ZeldBalance => b !== null);
  }

  /**
   * Read the connected wallet's Kontor holdings — KOR token balance and owned
   * NFTs — via a read-only KontorSession. Requires `kontorNetwork: "signet"` (and
   * the client `network` to be "testnet"); returns empty holdings when Kontor is
   * not configured rather than throwing. NFT enumeration additionally requires
   * `kontorNftContractAddress` (there is no cross-contract "all NFTs owned"
   * query).
   */
  async getKontorHoldings(): Promise<KontorHoldings> {
    const signer = this.signer;
    if (!signer || !this.kontorNetwork) return { kor: null, nfts: [] };

    const chain = resolveKontorChain(this.kontorNetwork);
    if (!chain || this.network !== "testnet") return { kor: null, nfts: [] };

    const addresses = signer.getAddresses();
    const xOnly = addresses.xOnlyPubkey;
    const taprootAddress = addresses.p2tr;
    if (!xOnly || !taprootAddress) return { kor: null, nfts: [] };

    const session = makeKontorReadSession({
      chain,
      xOnlyPubkey: xOnly,
      indexerUrl: this.kontorIndexerUrl,
      fetch: this.fetch,
    });

    try {
      // KOR balance for the session identity.
      let kor: KontorBalance | null = null;
      const raw = await bindKontorToken(session).balance(
        session.identity.holderRef,
      );
      if (raw) {
        const amount = raw.toString();
        if (amount !== "0") kor = { amount, address: taprootAddress };
      }

      // NFTs — only when a contract address is configured.
      const nfts: KontorNftHolding[] = [];
      if (this.kontorNftContractAddress) {
        const contractAddress = this.kontorNftContractAddress;
        const nft = bindKontorNft(session, contractAddress);
        const candidates = holderCandidates(
          session.identity.xOnlyPubKey,
          taprootAddress,
        );
        const seen = new Set<string>();
        for (const holder of candidates) {
          const total = await nft.countNftsByHolder(holder);
          if (total <= 0n) continue;
          const cap =
            total < KONTOR_NFT_MAX_PER_HOLDER ? total : KONTOR_NFT_MAX_PER_HOLDER;
          for (let offset = 0n; offset < cap; offset += KONTOR_NFT_PAGE) {
            const page = await nft.listNftsByHolder(
              holder,
              offset,
              KONTOR_NFT_PAGE,
            );
            for (const info of page) {
              if (seen.has(info.nftId)) continue;
              seen.add(info.nftId);
              nfts.push({
                nftId: info.nftId,
                contractAddress,
                address: taprootAddress,
              });
            }
            if (BigInt(page.length) < KONTOR_NFT_PAGE) break;
          }
        }
      }

      return { kor, nfts };
    } finally {
      session.close();
    }
  }

  // ─── Authentication (platform-fee credits) ──────────────────────────────────

  /**
   * Sign in with the configured wallet to attach a Horizon Market account to
   * subsequent requests. An authenticated account gets free monthly credits (or a
   * subscription), so the server waives the platform fee — `requestSellQuote` then
   * returns `feeWaived: true` / `feePsbt: null` and `openSellOrder` lists without an
   * on-chain fee payment.
   *
   * Flow: request a BIP322 challenge → sign it with the signer → complete the
   * NextAuth credentials sign-in. The session cookie is stored on the client.
   *
   * **Node / server contexts only** — the sign-in callback is not CORS-open. In a
   * same-origin browser app, rely on the website's existing session (or pass a
   * `sessionToken` to the constructor).
   *
   * @param opts.address Wallet address to authenticate as. Defaults to the signer's
   *   P2WPKH address.
   * @param opts.taprootAddress P2TR address to link. Defaults to the signer's P2TR.
   * @param opts.walletProvider Provider label recorded server-side. Defaults to
   *   `"horizon-market-client"`.
   */
  async signInWithWallet(opts?: {
    address?: string;
    taprootAddress?: string;
    walletProvider?: string;
  }): Promise<void> {
    const signer = this.assertSigner();
    const addresses = signer.getAddresses();
    const address = opts?.address ?? addresses.p2wpkh;
    const taprootAddress = opts?.taprootAddress ?? addresses.p2tr;

    const { nonce, message } = await apiRequestWalletChallenge(
      this.http,
      address,
    );
    const signature = signer.signMessage(address, message);

    await apiCompleteWalletSignIn(this.http, {
      address,
      signature,
      nonce,
      walletProvider: opts?.walletProvider ?? "horizon-market-client",
      taprootAddress,
    });
  }

  /** Read the current authenticated session, or `null` when signed out. */
  getSession(): Promise<SessionInfo | null> {
    return apiGetSession(this.http);
  }

  /** True once a session cookie has been established (via sign-in or `sessionToken`). */
  get isAuthenticated(): boolean {
    return this.http.hasSessionCookie();
  }

  /** Clear the stored session (and any other cookies). */
  signOut(): void {
    this.http.clearCookies();
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
