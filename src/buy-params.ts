import { assertMutuallyExclusive } from "./assert.js";
import type { BuyQuoteParams } from "./types/index.js";

export function isP2WpkhAddress(address: string): boolean {
  return address.startsWith("bc1q") || address.startsWith("tb1q");
}

export function assertP2WpkhBuyerAddress(address: string): void {
  if (!isP2WpkhAddress(address)) {
    throw new Error(
      `Buyer address must be P2WPKH (bc1q… or tb1q…), got: ${address}`,
    );
  }
}

export function assertNonEmptySwapIds(swapIds: string[]): void {
  if (swapIds.length === 0) {
    throw new Error("At least one swapId is required");
  }
}

export function assertBuyQuoteParams(params: BuyQuoteParams): void {
  assertNonEmptySwapIds(params.swapIds);
  assertP2WpkhBuyerAddress(params.buyerAddress);
  assertMutuallyExclusive(
    params.fundingUtxoIds,
    params.autoSelect,
    "fundingUtxoIds",
    "autoSelect",
  );
}
