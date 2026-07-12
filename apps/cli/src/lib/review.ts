import pc from "picocolors";
import type {
  AtomicSwap,
  HorizonMarketClient,
} from "@unspendablelabs/horizon-market-client";
import { CliError } from "./output.js";
import { formatSats, formatUsd, kv, satsToBtc } from "./format.js";

// ─── Fee-rate resolution ──────────────────────────────────────────────────────

/** Recommended sat/vByte rates from mempool.space `/v1/fees/recommended`. */
export interface FeeEstimates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

async function fetchFeeEstimates(
  fetchImpl: typeof globalThis.fetch,
  base: string,
): Promise<FeeEstimates | null> {
  try {
    const res = await fetchImpl(`${base}/v1/fees/recommended`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<FeeEstimates>;
    const fastest = num(b.fastestFee, 1);
    return {
      fastestFee: fastest,
      halfHourFee: num(b.halfHourFee, fastest),
      hourFee: num(b.hourFee, num(b.halfHourFee, fastest)),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a `--fee-rate` argument to a concrete sat/vByte. A numeric value is
 * used verbatim; `slow`/`normal`/`fast` (default `normal`) map to the live
 * mempool estimates (hour / half-hour / fastest — mirrors the SDK's `rateForOption`).
 */
export async function resolveFeeRate(
  fetchImpl: typeof globalThis.fetch,
  mempoolBase: string,
  arg: string | undefined,
): Promise<number> {
  const value = (arg ?? "normal").trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (n <= 0) throw new CliError("--fee-rate must be greater than 0", "BAD_FEE_RATE");
    return n;
  }
  if (value !== "slow" && value !== "normal" && value !== "fast") {
    throw new CliError(
      `Invalid --fee-rate "${value}" (expected slow | normal | fast | <number>)`,
      "BAD_FEE_RATE",
    );
  }
  const estimates = await fetchFeeEstimates(fetchImpl, mempoolBase);
  if (!estimates) {
    throw new CliError(
      "Could not fetch fee estimates — pass a numeric --fee-rate (sat/vByte).",
      "NO_FEE_ESTIMATES",
    );
  }
  return value === "fast"
    ? estimates.fastestFee
    : value === "slow"
      ? estimates.hourFee
      : estimates.halfHourFee;
}

// ─── Sell cost preview (mirrors useSellQuotePreview) ──────────────────────────

/** Cost breakdown for listing a sell order (all in sats). */
export interface SellCost {
  listing: number;
  attach: number;
  network: number;
  total: number;
  feeWaived: boolean;
}

export interface SellPreviewParams {
  price: number;
  sellerAddress: string;
  listingType: "counterparty" | "ordinal" | "zeld";
  assetUtxoId?: string;
  assetName?: string;
  assetQuantity?: bigint;
  autoSelectFeeUtxos?: boolean;
  satsPerVbyte?: number;
}

/** Side-effect-free listing cost preview (`requestSellQuote({ preview: true })`). */
export async function previewSellCost(
  client: HorizonMarketClient,
  p: SellPreviewParams,
): Promise<SellCost> {
  const q = await client.requestSellQuote({
    price: p.price,
    sellerAddress: p.sellerAddress,
    listingType: p.listingType,
    assetUtxoId: p.assetUtxoId,
    assetName: p.assetName,
    assetQuantity: p.assetQuantity,
    autoSelectFeeUtxos: p.autoSelectFeeUtxos,
    ...(p.satsPerVbyte != null ? { satsPerVbyte: p.satsPerVbyte } : {}),
    preview: true,
  });
  const listing = q.listingFeeSats ?? 0;
  const attach = q.attachFeeSats ?? 0;
  const network = q.networkFeeSats ?? 0;
  return { listing, attach, network, total: listing + attach + network, feeWaived: q.feeWaived };
}

// ─── Buy quote preview (mirrors useBuyReview / useBuyQuotePreview) ─────────────

/** Buyer cost breakdown for filling a swap (all in sats; null total for Kontor). */
export interface BuyCost {
  priceSats: number;
  royaltySats: number | null;
  minerFeeSats: number | null;
  totalSats: number | null;
}

export interface BuyPreviewParams {
  buyerAddress: string;
  buyerTaprootAddress: string;
  detach: boolean;
  satsPerVbyte: number;
}

/**
 * Compose the buyer cost for `swap`. For a Kontor listing there is no server-side
 * buy quote (the commit + reveal are composed at accept time), so only the
 * price + royalty are known up front (miner fee set at confirm).
 */
export async function previewBuyCost(
  client: HorizonMarketClient,
  swap: AtomicSwap,
  p: BuyPreviewParams,
): Promise<BuyCost> {
  const priceSats = swap.price;
  if (swap.listingType === "kontor") {
    return {
      priceSats,
      royaltySats: swap.royalty,
      minerFeeSats: null,
      totalSats: null,
    };
  }
  const quote = await client.requestBuyQuote({
    swapIds: [swap.id],
    buyerAddress: p.buyerAddress,
    buyerTaprootAddress: p.buyerTaprootAddress,
    autoSelect: true,
    detach: p.detach,
    satsPerVbyte: p.satsPerVbyte,
  });
  const royaltySats = quote.royaltySats ?? swap.royalty;
  const minerFeeSats = quote.feeEstimateSats;
  return {
    priceSats,
    royaltySats,
    minerFeeSats,
    totalSats: priceSats + (royaltySats ?? 0) + minerFeeSats,
  };
}

// ─── Human render helpers ─────────────────────────────────────────────────────

function satsLine(label: string, sats: number, btcUsd: number | null): string {
  const usd = formatUsd(sats, btcUsd);
  return kv(label, `${formatSats(sats)} sats${usd ? pc.dim(`  (${usd})`) : ""}`);
}

/** Print the sell listing review to stdout (TTY only). */
export function renderSellReview(
  heading: string,
  cost: SellCost,
  btcUsd: number | null,
): void {
  console.log(pc.bold(`\n${heading}`));
  console.log(satsLine("Listing fee", cost.listing, btcUsd));
  console.log(satsLine("Asset prep", cost.attach, btcUsd));
  console.log(satsLine("Network fee", cost.network, btcUsd));
  console.log(satsLine("Total to list", cost.total, btcUsd));
  if (cost.feeWaived) console.log(pc.dim("  Platform fee waived (credits / subscription)."));
}

/** Print the Kontor sell listing review to stdout (TTY only). */
export function renderKontorSellReview(
  heading: string,
  listingFeeSats: number,
  feeWaived: boolean,
  btcUsd: number | null,
): void {
  console.log(pc.bold(`\n${heading}`));
  console.log(satsLine("Listing fee", listingFeeSats, btcUsd));
  console.log(pc.dim("  + on-chain attach-reveal miner fee (set at confirm)."));
  if (feeWaived) console.log(pc.dim("  Platform fee waived (credits / subscription)."));
}

/** Print the buy review to stdout (TTY only). */
export function renderBuyReview(heading: string, cost: BuyCost, btcUsd: number | null): void {
  console.log(pc.bold(`\n${heading}`));
  console.log(satsLine("Price", cost.priceSats, btcUsd));
  console.log(satsLine("Royalty", cost.royaltySats ?? 0, btcUsd));
  if (cost.minerFeeSats != null) {
    console.log(satsLine("Miner fee", cost.minerFeeSats, btcUsd));
  } else {
    console.log(kv("Miner fee", pc.dim("set at confirm (Kontor)")));
  }
  if (cost.totalSats != null) {
    console.log(satsLine("Total to pay", cost.totalSats, btcUsd));
  } else {
    console.log(kv("Total to pay", pc.dim(`≈ ${formatSats(cost.priceSats + (cost.royaltySats ?? 0))} + miner fee`)));
  }
}

/** Print the send review to stdout (TTY only). */
export function renderSendReview(
  heading: string,
  feeSats: bigint | null,
  btcUsd: number | null,
): void {
  console.log(pc.bold(`\n${heading}`));
  if (feeSats != null) {
    const usd = formatUsd(Number(feeSats), btcUsd);
    console.log(kv("Network fee", `${satsToBtc(feeSats)} BTC${usd ? pc.dim(`  (${usd})`) : ""}`));
  } else {
    console.log(kv("Network fee", pc.dim("set at confirm (Kontor)")));
  }
}
