import { useCallback, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  ListingReport,
  ListingReportReason,
  ReportableListingQuery,
} from "../../types/index.js";

export type ReportListingStatus =
  | "idle"
  | "submitting"
  | "success"
  /** The target was a token that has never been listed — nothing to report to. */
  | "unlisted"
  | "error";

/**
 * What a report is about: a listing by its atomic-swap id, or a token by the
 * query that names its listings (see `reportableListingQueryFor`), resolved to
 * a listing at submit time.
 */
export type ReportListingTarget = string | ReportableListingQuery;

export interface UseReportListingOptions {
  /**
   * The listing or token being reported. Optional at construction so a single
   * hook can serve a form that learns its target late; `submit` then takes it.
   */
  target?: ReportListingTarget;
}

export interface UseReportListingResult {
  /**
   * True once a report can be filed: the provider's wallet sign-in has landed.
   * Reporting is session-gated so the reporter is identifiable — gate the form
   * on this and show the connect / signing-in state otherwise (the provider's
   * `addresses` and `signInError` say which).
   */
  canReport: boolean;
  status: ReportListingStatus;
  /** The server's acknowledgement once accepted (`duplicate` on a replay), else null. */
  result: ListingReport | null;
  /** Why the report was refused, else null. */
  error: Error | null;
  /**
   * File the report. Never rejects — the outcome lands in `status` / `result` /
   * `error`, so a press handler needs no try/catch. Ignored while one is already
   * in flight. `target` overrides the option of the same name.
   */
  submit: (params: {
    reason: ListingReportReason;
    details?: string;
    target?: ReportListingTarget;
  }) => Promise<void>;
  /** Back to `idle`, clearing the last result/error (e.g. when reopening a dialog). */
  reset: () => void;
}

/**
 * Report a listing — or the token it escrows — for moderator review.
 *
 * App Store guideline 1.2 asks every app that shows user-generated content for
 * a way to report it, and the token page is where a user meets that content.
 * A report names a *listing*, though: that is the only key every listing type
 * shares. So this accepts either — a swap id when the caller has one, or the
 * token's listing query, which it resolves to a swap (open, else sold, else
 * delisted) before posting. A token no one ever listed ends in `"unlisted"`
 * rather than `"error"`: there is nothing wrong to retry, and the copy is
 * different.
 */
export function useReportListing(
  options: UseReportListingOptions = {},
): UseReportListingResult {
  const { client, isAuthenticated } = useHorizonMarket();
  const { target: defaultTarget } = options;

  const [status, setStatus] = useState<ReportListingStatus>("idle");
  const [result, setResult] = useState<ListingReport | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Bumped by every submit and by reset(); a response whose sequence is stale
  // (the dialog was closed and reopened) is dropped rather than painted over
  // whatever the user is looking at now.
  const seqRef = useRef(0);
  const pendingRef = useRef(false);

  const submit = useCallback<UseReportListingResult["submit"]>(
    async ({ reason, details, target = defaultTarget }) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      const seq = ++seqRef.current;
      setStatus("submitting");
      setResult(null);
      setError(null);
      try {
        if (target === undefined) {
          throw new Error("Nothing to report: no listing or token was given");
        }
        const atomicSwapId =
          typeof target === "string"
            ? target
            : await client.findReportableListingId(target);
        if (seq !== seqRef.current) return;
        if (!atomicSwapId) {
          setStatus("unlisted");
          return;
        }
        const report = await client.reportListing({ atomicSwapId, reason, details });
        if (seq !== seqRef.current) return;
        setResult(report);
        setStatus("success");
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      } finally {
        // Only the current generation owns the flag: an abandoned submit settling
        // after a reset() must not clear a *newer* submit's in-flight guard.
        if (seq === seqRef.current) pendingRef.current = false;
      }
    },
    [client, defaultTarget],
  );

  const reset = useCallback(() => {
    seqRef.current++;
    pendingRef.current = false;
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { canReport: isAuthenticated, status, result, error, submit, reset };
}
