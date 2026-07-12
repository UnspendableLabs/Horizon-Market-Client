import { assertMutuallyExclusive } from "./assert.js";
import type { BuyQuoteParams } from "./types/index.js";

export function isP2WpkhAddress(address: string): boolean {
  // v0 20-byte witness program: 42-char bech32 ("bc1q…" / "tb1q…"). The length
  // check excludes P2WSH, which shares the prefix but is 62 chars.
  return /^(bc1q|tb1q)[a-z0-9]{38}$/.test(address);
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
