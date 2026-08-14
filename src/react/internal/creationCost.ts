import { formatSats, formatUsd } from "./format.js";
import { xcpNameFee } from "../../creation-params.js";
import type { CreationQuote } from "../../api/creations.js";

/** Postage carried by an inscription output — it stays with the inscription. */
const ORDINAL_POSTAGE_SATS = 546;

/**
 * XCP with up to 8 decimals and no trailing noise.
 *
 * Balances arrive as base units divided by 1e8, so a dust holding renders as
 * `1e-8` under the default `toString` — a number nobody reads as money.
 */
export function formatXcp(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

/**
 * Explanations behind the (i) hints on a creation review, so the packaged UI and
 * a custom one say the same thing.
 */
export const CREATION_FEE_HINTS = {
  network: "Miner fee for the transaction that creates your token.",
  postage:
    "546 sats carried by the inscription's output. It is not a fee — it stays with the inscription and moves with it.",
  xcp: "Counterparty charges this in XCP to register the name, on top of the Bitcoin fee above. Numeric A… names are free.",
};

export interface CreationCostLine {
  key: "network" | "postage" | "total";
  label: string;
  sats: number;
  /** Formatted sats, e.g. "1,240 SATS". */
  satsDisplay: string;
  /** Formatted USD, or `null` without a BTC price. */
  usd: string | null;
  hint?: string;
  /** True for the row a renderer should set apart as the sum. */
  emphasis?: boolean;
}

/**
 * The cost rows for a creation quote, in display order.
 *
 * An ordinal's total includes 546 sats of postage, which is not a fee — so it
 * gets its own row rather than inflating the miner fee. Counterparty's total is
 * BTC only: the XCP name fee is charged in XCP and is described by
 * {@link xcpFeeNotice}, not by a sats row that would be wrong.
 */
export function creationCostLines(
  quote: CreationQuote,
  btcUsd: number | null,
): CreationCostLine[] {
  const lines: CreationCostLine[] = [
    {
      key: "network",
      label: "Network fee",
      sats: quote.estimatedFeeSats,
      satsDisplay: formatSats(quote.estimatedFeeSats),
      usd: formatUsd(quote.estimatedFeeSats, btcUsd),
      hint: CREATION_FEE_HINTS.network,
    },
  ];

  // Anything the total carries beyond the miner fee is postage; the server puts
  // it there for ordinals only, but deriving it keeps the rows adding up even if
  // that ever changes.
  const extra = quote.totalCostSats - quote.estimatedFeeSats;
  if (extra > 0) {
    lines.push({
      key: "postage",
      label: "Inscription postage",
      sats: extra,
      satsDisplay: formatSats(extra),
      usd: formatUsd(extra, btcUsd),
      hint:
        extra === ORDINAL_POSTAGE_SATS ? CREATION_FEE_HINTS.postage : undefined,
    });
  }

  lines.push({
    key: "total",
    label: "Total",
    sats: quote.totalCostSats,
    satsDisplay: formatSats(quote.totalCostSats),
    usd: formatUsd(quote.totalCostSats, btcUsd),
    emphasis: true,
  });

  return lines;
}

/**
 * The XCP the name itself costs, phrased for a review screen — or `null` when
 * there is nothing to say (a numeric name, or any non-Counterparty creation).
 *
 * Worth its own line because a quote's total is BTC only: without this the
 * screen shows a number that is not the whole cost.
 */
export function xcpFeeNotice(
  type: string,
  name: string,
): { requiredXcp: number; text: string } | null {
  if (type !== "counterparty") return null;
  const requiredXcp = xcpNameFee(name);
  if (requiredXcp <= 0) return null;
  return {
    requiredXcp,
    text: `Counterparty also charges ${requiredXcp} XCP to register this name, separate from the Bitcoin fee.`,
  };
}
