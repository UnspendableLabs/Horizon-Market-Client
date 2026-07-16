/**
 * Recovery info for a Kontor purchase whose swap reveal was broadcast on-chain
 * but whose server-side recording failed (see {@link
 * import("../workflows/buy-kontor.js").KontorPurchaseNotRecordedError}). The
 * offer is already consumed, so the fix is to replay ONLY the recording POST
 * with the carried swap-reveal `txId` — never re-run `fillSwaps`, which would
 * compose and broadcast a fresh, wasted swap.
 */
export interface KontorPurchaseRecovery {
  swapId: string;
  /** Txid of the already-broadcast swap reveal. */
  txId: string;
  buyerAddress: string;
}

/**
 * Extract {@link KontorPurchaseRecovery} from a caught error iff it is a
 * `KontorPurchaseNotRecordedError`, else `null`.
 *
 * Detection is by `name` + duck-typed fields rather than `instanceof` on
 * purpose: the error class lives in `workflows/buy-kontor.ts`, which statically
 * pulls in the heavy `@kontor/sdk` backend. Importing it here (and thus into the
 * React hooks that call this) would defeat the client's dynamic-import isolation
 * of the Kontor chunk and load the backend into the main bundle at startup.
 */
export function kontorPurchaseRecovery(
  err: unknown,
): KontorPurchaseRecovery | null {
  if (!(err instanceof Error) || err.name !== "KontorPurchaseNotRecordedError") {
    return null;
  }
  const e = err as { swapId?: unknown; txId?: unknown; buyerAddress?: unknown };
  if (
    typeof e.swapId === "string" &&
    typeof e.txId === "string" &&
    typeof e.buyerAddress === "string"
  ) {
    return { swapId: e.swapId, txId: e.txId, buyerAddress: e.buyerAddress };
  }
  return null;
}
