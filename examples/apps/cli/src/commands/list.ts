import { defineCommand } from "citty";
import pc from "picocolors";
import Table from "cli-table3";
import type {
  AtomicSwap,
  ListingType,
  ListSwapsParams,
} from "@unspendablelabs/horizon-market-client";
import { globalArgs } from "../context.js";
import { CliError, note, runCommand } from "../lib/output.js";
import { getNetworkConfig } from "../lib/networks.js";
import { readKeystore } from "../lib/keystore.js";
import { walletAddresses } from "../lib/wallet.js";
import { createClient } from "../lib/client.js";
import {
  formatAge,
  formatAssetQuantity,
  formatSats,
  satsToBtc,
  truncate,
} from "../lib/format.js";

type SortOption = "latest" | "oldest" | "cheapest" | "expensive" | "cheapest_unit";

/** UI sort option → server `orderBy`/`order`. Exported for tests. */
export const SORT_MAP: Record<
  SortOption,
  { orderBy: "created_at" | "price" | "price_per_unit"; order: "asc" | "desc" }
> = {
  latest: { orderBy: "created_at", order: "desc" },
  oldest: { orderBy: "created_at", order: "asc" },
  cheapest: { orderBy: "price", order: "asc" },
  expensive: { orderBy: "price", order: "desc" },
  cheapest_unit: { orderBy: "price_per_unit", order: "asc" },
};

const LISTING_TYPES: ListingType[] = ["counterparty", "ordinal", "zeld", "kontor"];

/**
 * Only purchasable listings: drop `pending` (a buy tx is already in the mempool)
 * and `anomalous` (server-flagged bad state) — mirrors `useSwapList`.
 */
export function isPurchasable(s: AtomicSwap): boolean {
  return !s.pending && !s.anomalous;
}

/** Human-friendly asset label for a swap row. Exported for tests. */
export function assetLabel(s: AtomicSwap): string {
  if (s.listingType === "ordinal") {
    return s.inscriptionNumber != null ? `#${s.inscriptionNumber}` : "Inscription";
  }
  if (s.listingType === "kontor") {
    return s.kontorAssetKind === "nft" ? "NFT" : "KOR";
  }
  return s.assetName ?? "—";
}

/**
 * A swap's asset is divisible (8-decimal base units) when it's a ZELD listing or
 * Counterparty flags `assetDivisibility`. Mirrors the app's swap-list helpers.
 */
function swapDivisible(s: AtomicSwap): boolean {
  return s.listingType === "zeld" || s.assetDivisibility === true;
}

/**
 * Quantity cell for a swap row. Divisible assets store `assetQuantity` in base
 * units (×1e8) and must be scaled down; Kontor tokens carry their amount in
 * `kontorAmount`; 1-of-1 items (ordinals, Kontor NFTs) show "1". Exported for tests.
 */
export function displayQuantity(s: AtomicSwap): string {
  if (s.listingType === "kontor") {
    return s.kontorAssetKind === "nft" ? "1" : (s.kontorAmount ?? "1");
  }
  if (s.listingType === "ordinal") return "1";
  if (s.assetQuantity == null) return "1";
  return formatAssetQuantity(s.assetQuantity, swapDivisible(s));
}

/**
 * Per-unit price cell (sats per whole unit). The server computes `pricePerUnit`
 * as `price * 1e8 / rawQuantity`, so for a divisible asset it already reads as
 * sats per whole unit, but for an indivisible asset it's over-scaled by 1e8 and
 * must be divided back down. Mirrors the app's `swapDisplayPricePerUnit`.
 * Exported for tests.
 */
export function displayPricePerUnit(s: AtomicSwap): string {
  if (s.pricePerUnit == null) return "—";
  const perUnit = swapDivisible(s) ? s.pricePerUnit : s.pricePerUnit / 1e8;
  return perUnit.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** Numeric sort key for a swap under a given `orderBy`. Exported for tests. */
export function sortKey(s: AtomicSwap, orderBy: "created_at" | "price" | "price_per_unit"): number {
  if (orderBy === "price") return s.price;
  if (orderBy === "price_per_unit") return s.pricePerUnit ?? Number.POSITIVE_INFINITY;
  return Date.parse(s.createdAt) || 0;
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List open swap listings (read-only, no password)",
  },
  args: {
    ...globalArgs,
    type: {
      type: "string",
      description: "Filter by listing type: counterparty | ordinal | zeld | kontor",
    },
    asset: { type: "string", description: "Filter by asset name" },
    search: { type: "string", description: "Free-text search" },
    sort: {
      type: "string",
      description: "latest | oldest | cheapest | expensive | cheapest_unit (default latest)",
      default: "latest",
    },
    mine: { type: "boolean", description: "Only your own listings", default: false },
    limit: { type: "string", description: "Rows per page (default 24)", default: "24" },
    page: { type: "string", description: "Zero-based page index (default 0)", default: "0" },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      const stored = readKeystore(cli.homeDir);
      const uiNetwork = cli.networkOverride ?? stored?.network ?? "mainnet";
      const cfg = getNetworkConfig(uiNetwork);
      const client = createClient(cfg);

      const sortName = String(ctx.args.sort);
      // `Object.hasOwn` (not `in`) so inherited keys like "toString" don't slip
      // past validation and index into the prototype.
      if (!Object.hasOwn(SORT_MAP, sortName)) {
        throw new CliError(
          `Invalid --sort "${sortName}" (expected ${Object.keys(SORT_MAP).join(" | ")})`,
          "BAD_SORT",
        );
      }
      const sort = SORT_MAP[sortName as SortOption];

      const type = ctx.args.type ? (String(ctx.args.type) as ListingType) : undefined;
      if (type && !LISTING_TYPES.includes(type)) {
        throw new CliError(`Invalid --type "${type}"`, "BAD_TYPE");
      }

      const limit = Math.max(1, Number(ctx.args.limit) || 24);
      const page = Math.max(0, Number(ctx.args.page) || 0);

      // Kontor is signet-only: without kontorNetwork the query returns nothing.
      const kontorUnavailable = type === "kontor" && cfg.kontorNetwork !== "signet";

      const baseParams: ListSwapsParams = {
        listingType: type,
        assetName: ctx.args.asset ? String(ctx.args.asset) : undefined,
        search: ctx.args.search ? String(ctx.args.search) : undefined,
        orderBy: sort.orderBy,
        order: sort.order,
        funded: true,
        filled: false,
        delisted: false,
      };

      const keep = isPurchasable;

      let swaps: AtomicSwap[];
      let total: number;

      if (kontorUnavailable) {
        swaps = [];
        total = 0;
        note(cli, "Kontor is signet-only — pass --network signet to list Kontor swaps.");
      } else if (ctx.args.mine) {
        if (!stored) {
          throw new CliError("--mine needs a keystore. Run \"horizon init\" first.", "NO_KEYSTORE");
        }
        const addrs = walletAddresses(stored, cfg.sdkNetwork);
        const sellerAddresses = [...new Set([addrs.p2wpkh, addrs.p2tr])];
        const results = await Promise.all(
          sellerAddresses.map((sellerAddress) =>
            client.listSwaps({ ...baseParams, sellerAddress, offset: 0, limit: 500 }),
          ),
        );
        const byId = new Map<string, AtomicSwap>();
        for (const r of results) for (const s of r.atomicSwaps) byId.set(s.id, s);
        const merged = [...byId.values()].filter(keep).sort((a, b) => {
          const d = sortKey(a, sort.orderBy) - sortKey(b, sort.orderBy);
          return sort.order === "asc" ? d : -d;
        });
        total = merged.length;
        swaps = merged.slice(page * limit, page * limit + limit);
      } else {
        const result = await client.listSwaps({
          ...baseParams,
          offset: page * limit,
          limit,
        });
        const filtered = result.atomicSwaps.filter(keep);
        swaps = filtered;
        // Adjust the server total by the non-purchasable rows dropped on THIS
        // page — a per-page approximation (the true post-filter total across all
        // pages isn't known without fetching them). Mirrors useSwapList's
        // `setTotal(count - (items.length - filtered.length))` for parity.
        total = result.pagination.total - (result.atomicSwaps.length - filtered.length);
      }

      return {
        json: {
          count: swaps.length,
          swaps,
          pagination: { total, offset: page * limit, limit },
        },
        human: () => {
          if (swaps.length === 0) {
            console.log(pc.dim(`No open listings on ${cfg.label}.`));
            return;
          }
          const table = new Table({
            head: ["ID", "Type", "Asset", "Qty", "Price (sats)", "BTC", "Per unit", "Seller", "Age"].map(
              (h) => pc.dim(h),
            ),
            style: { head: [], border: [] },
          });
          for (const s of swaps) {
            table.push([
              truncate(s.id, 6, 4),
              s.listingType,
              assetLabel(s),
              displayQuantity(s),
              formatSats(s.price),
              satsToBtc(BigInt(s.price)),
              displayPricePerUnit(s),
              truncate(s.sellerAddress, 6, 4),
              formatAge(s.createdAt),
            ]);
          }
          console.log(table.toString());
          console.log(pc.dim(`\n${swaps.length} shown • ${total} total • page ${page} on ${cfg.label}`));
        },
      };
    });
  },
});
