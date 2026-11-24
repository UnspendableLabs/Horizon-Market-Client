/**
 * Uncertain Kontor publications.
 *
 * Since `@kontor/sdk` 0.3.0-rc.8 a failed broadcast request no longer means
 * nothing was sent: Bitcoin can accept a commit and reject its reveal, or accept
 * both while the HTTP response is lost. The SDK then throws a `SubmissionError`
 * whose `recovery` handle holds the exact signed package (and, for a listing,
 * the signed seller offer), instead of a plain transport error.
 *
 * Starting the operation over from there is the one thing a caller must not do:
 * it composes and signs a *new* package, which can send a transfer twice or
 * strand a second commit. So every Kontor write in this client goes through
 * {@link settleKontorPublication}, which re-checks the original package once,
 * read-only, and either carries on with its saved result or hands the handle to
 * the caller in a {@link KontorPublicationUnresolvedError}.
 *
 * Deliberately free of any `@kontor/sdk` value import (the SDK error is matched
 * by name and shape, its types are erased), so the error class can be exported
 * from any entry without loading the Kontor backend.
 */
import type { PendingSubmission } from "@kontor/sdk";

/** The Kontor write whose publication is unresolved. */
export type KontorPublicationOperation =
  "listing" | "purchase" | "delisting" | "transfer";

/**
 * A Kontor transaction package was signed and handed to the network, but
 * neither its broadcast nor a read-only re-check could confirm that Bitcoin
 * accepted all of it. It may already be on-chain.
 *
 * Do not re-run the operation. `recovery` is the SDK's handle on the exact
 * signed bytes: `reconcile()` re-checks without sending anything, `retry()`
 * re-sends the same bytes (it never composes or signs again), and
 * `recovery.transactions` keeps the raw hex for wallet repair. Both resolve with
 * the operation's saved result once every transaction is observed — for a
 * listing, `value.value` is the signed `Offer`, whose `serialize()` is the blob
 * to record.
 *
 * The handle lives only in this process, and the funding source behind it
 * belonged to the one call that failed: `abandon()` has no effect on later
 * calls, which re-read the wallet's UTXOs from scratch.
 *
 * The message is written for the end user, because UIs show it verbatim.
 */
export class KontorPublicationUnresolvedError extends Error {
  readonly operation: KontorPublicationOperation;
  /** Txid of the signed reveal — the transaction to look for on-chain. */
  readonly txid: string;
  /** The SDK's recovery handle for the exact signed package. */
  readonly recovery: PendingSubmission;
  override readonly cause?: unknown;

  constructor(
    operation: KontorPublicationOperation,
    recovery: PendingSubmission,
    cause: unknown,
  ) {
    const txid = revealTxid(recovery);
    super(
      `Your Kontor ${operation} was signed and sent, but the network could not ` +
        `confirm it received the transaction (${txid}). It may already be ` +
        `on-chain. Do not start the ${operation} again — that could spend the ` +
        `same coins twice. Check again in a few minutes.`,
    );
    this.name = "KontorPublicationUnresolvedError";
    this.operation = operation;
    this.txid = txid;
    this.recovery = recovery;
    this.cause = cause;
  }
}

/**
 * The {@link KontorPublicationUnresolvedError} behind a failure, or null.
 *
 * UIs use it to tell an uncertain publication apart from every other failure:
 * for those, starting over is the fix, while here it is the one thing that can
 * send twice. Matched by name as well as `instanceof`, like the SDK error
 * below, so a second copy of this module is still recognised.
 */
export function unresolvedKontorPublication(
  err: unknown,
): KontorPublicationUnresolvedError | null {
  if (err instanceof KontorPublicationUnresolvedError) return err;
  if (
    err instanceof Error &&
    err.name === "KontorPublicationUnresolvedError" &&
    typeof (err as Partial<KontorPublicationUnresolvedError>).recovery
      ?.retry === "function"
  ) {
    return err as KontorPublicationUnresolvedError;
  }
  return null;
}

/** The shape of `@kontor/sdk`'s `SubmissionError` this module relies on. */
interface SubmissionErrorLike extends Error {
  recovery: PendingSubmission;
}

/**
 * True for the SDK's `SubmissionError`. Matched by name and shape rather than
 * `instanceof`, so a host that ends up with two copies of `@kontor/sdk` (or a
 * bundler that splits it) is still recognised.
 */
export function isKontorSubmissionError(
  err: unknown,
): err is SubmissionErrorLike {
  if (!(err instanceof Error) || err.name !== "SubmissionError") return false;
  const recovery = (err as { recovery?: Partial<PendingSubmission> }).recovery;
  return (
    recovery != null &&
    typeof recovery.reconcile === "function" &&
    Array.isArray(recovery.transactions) &&
    recovery.transactions.length > 0
  );
}

/** Txid of the package's reveal — always its last transaction. */
function revealTxid(recovery: PendingSubmission): string {
  return recovery.transactions[recovery.transactions.length - 1]?.txid ?? "";
}

/**
 * The reveal txid an accepted recovery saved for `submit` / `accept` /
 * `revoke` (their `{ result: { txid } }`), falling back to the package itself.
 */
export function recoveredRevealTxid(
  saved: unknown,
  recovery: PendingSubmission,
): string {
  const txid = (saved as { result?: { txid?: unknown } } | null)?.result?.txid;
  return typeof txid === "string" && txid.length > 0
    ? txid
    : revealTxid(recovery);
}

/**
 * Run a Kontor publication, settling an uncertain broadcast before giving up.
 *
 * Any error other than the SDK's `SubmissionError` — a refusal before signing,
 * a rejected compose — is rethrown untouched: nothing was published, and the
 * SDK has already released its funding. On a `SubmissionError` the original
 * package is reconciled once (read-only, nothing is sent). If every transaction
 * is observed the publication did happen, and `fromSaved` turns the saved
 * result into what `publish` would have returned. Otherwise, or if `fromSaved`
 * cannot, a {@link KontorPublicationUnresolvedError} carries the handle out.
 */
export async function settleKontorPublication<T>(
  operation: KontorPublicationOperation,
  publish: () => Promise<T>,
  fromSaved: (saved: unknown, recovery: PendingSubmission) => T | null,
): Promise<T> {
  try {
    return await publish();
  } catch (err) {
    if (!isKontorSubmissionError(err)) throw err;
    const { recovery } = err;
    let saved: unknown;
    try {
      saved = await recovery.reconcile();
    } catch (unresolved) {
      throw new KontorPublicationUnresolvedError(
        operation,
        recovery,
        unresolved,
      );
    }
    const result = fromSaved(saved, recovery);
    if (result === null) {
      throw new KontorPublicationUnresolvedError(operation, recovery, err);
    }
    return result;
  }
}
