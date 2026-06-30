import * as btc from "bitcoinjs-lib";
import type { KontorAssetKind } from "../../types/index.js";

/**
 * Kontor attach miner-fee estimation (client-side, calibrated).
 *
 * A Kontor attach is a two-tx package: a funding **commit** then the **reveal**
 * that escrows the asset. Only the seller pays both miner fees. The marketplace
 * offer blob carries just the *reveal* hex, so we measure the reveal's real
 * vsize from an existing same-kind listing and add a typical single-input
 * commit. The reveal is stable per asset kind; the commit scales with how many
 * funding UTXOs the seller's wallet needs — which isn't known until the tx is
 * actually composed at signing. Hence this is an estimate (exact when the seller
 * funds from a single UTXO), not the sat-perfect cost.
 */

/**
 * vsize of a 1-input, 2-output P2TR funding commit (measured from a real signet
 * attach commit). More funding inputs raise the real fee above this estimate.
 */
export const KONTOR_COMMIT_VSIZE = 154;

/**
 * Reveal vsizes measured from real signet attach reveals, used when no live
 * same-kind listing is available to calibrate against.
 */
export const FALLBACK_REVEAL_VSIZE: Record<KontorAssetKind, number> = {
  token: 227,
  nft: 216,
};

/** Parse an offer blob and return the attach reveal's vsize, or null. */
export function revealVsizeFromBlob(blob: string): number | null {
  try {
    const { attachReveal } = JSON.parse(blob) as { attachReveal?: unknown };
    if (typeof attachReveal !== "string" || !attachReveal) return null;
    return btc.Transaction.fromHex(attachReveal).virtualSize();
  } catch {
    return null;
  }
}

/** Estimated total attach miner fee (sats) = (reveal + commit) vsize × feeRate. */
export function estimateKontorMinerFee(
  revealVsize: number,
  feeRate: number,
): number {
  return Math.ceil((revealVsize + KONTOR_COMMIT_VSIZE) * feeRate);
}
