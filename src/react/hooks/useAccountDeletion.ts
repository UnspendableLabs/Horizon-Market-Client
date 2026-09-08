import { useCallback, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  AccountDeletionRequest,
  AccountDeletionRequestParams,
} from "../../types/index.js";

export type AccountDeletionStatus =
  | "idle"
  | "submitting"
  | "success"
  /** The request named neither an email nor an address — nothing to match on. */
  | "invalid"
  | "error";

export interface UseAccountDeletionOptions {
  /**
   * Addresses to name on every request, in place of the connected wallet's.
   * Defaults to the wallet's own addresses, which is what makes a request from
   * a signed-in user provable; pass `[]` to name none of them.
   */
  addresses?: string[];
}

export interface UseAccountDeletionResult {
  /**
   * The addresses this will name on top of anything the form adds — the
   * connected wallet's, or the `addresses` option when given. Empty with no
   * wallet connected, which is the case this whole flow exists for.
   */
  walletAddresses: string[];
  /**
   * True when the request will carry a session the server can check the named
   * identity against. Not a requirement — it decides whether the request
   * arrives *proven* or as a support ticket a human matches by hand.
   */
  canProveOwnership: boolean;
  status: AccountDeletionStatus;
  /** The server's acknowledgement once accepted (`duplicate` on a replay), else null. */
  result: AccountDeletionRequest | null;
  /** Why the request was refused, else null. */
  error: Error | null;
  /**
   * File the request. Never rejects — the outcome lands in `status` / `result` /
   * `error`, so a press handler needs no try/catch. Ignored while one is already
   * in flight. `addresses` are added to {@link walletAddresses}, not instead of
   * them.
   */
  submit: (params?: AccountDeletionRequestParams) => Promise<void>;
  /** Back to `idle`, clearing the last result/error (e.g. when reopening a dialog). */
  reset: () => void;
}

/**
 * Ask for the account to be deleted.
 *
 * App Store guideline 5.1.1(v) requires every app that creates accounts to
 * offer a way to delete one, reachable by someone who can no longer sign in.
 * So this posts a *request* rather than deleting anything: it names the account
 * by email and/or connected addresses, and an admin matches it to a user before
 * acting. Deletion is not instant and the copy around this hook should say so.
 *
 * A connected wallet's addresses are named by default and the client's bearer
 * token rides along, so a signed-in user's request arrives proven — the server
 * checks the session against the identity named, which is what lets a real
 * owner's request take over one a stranger filed first. With no wallet the flow
 * still works; the request is then a support ticket, and the form has to collect
 * an email or an address for it to name.
 */
export function useAccountDeletion(
  options: UseAccountDeletionOptions = {},
): UseAccountDeletionResult {
  const { client, addresses: wallet, isAuthenticated } = useHorizonMarket();
  const { addresses: addressesOption } = options;

  const walletAddresses = useMemo(() => {
    if (addressesOption) return addressesOption;
    if (!wallet) return [];
    // Both encodings of the one key: an account may have connected under either,
    // and the matcher looks the address up as it was stored.
    return [wallet.p2wpkh, wallet.p2tr].filter(
      (address): address is string => Boolean(address),
    );
  }, [addressesOption, wallet]);

  const [status, setStatus] = useState<AccountDeletionStatus>("idle");
  const [result, setResult] = useState<AccountDeletionRequest | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Bumped by every submit and by reset(); a response whose sequence is stale
  // (the dialog was closed and reopened) is dropped rather than painted over
  // whatever the user is looking at now.
  const seqRef = useRef(0);
  const pendingRef = useRef(false);

  const submit = useCallback<UseAccountDeletionResult["submit"]>(
    async (params = {}) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      const seq = ++seqRef.current;
      setStatus("submitting");
      setResult(null);
      setError(null);
      try {
        const email = params.email?.trim();
        const addresses = [...walletAddresses, ...(params.addresses ?? [])];
        // Checked here rather than left to the client's throw so the caller can
        // tell "you have to fill something in" apart from a failed request: one
        // is a field to correct, the other a button to press again.
        if (!email && addresses.length === 0) {
          setStatus("invalid");
          return;
        }
        const request = await client.requestAccountDeletion({
          ...params,
          ...(email ? { email } : {}),
          addresses,
        });
        if (seq !== seqRef.current) return;
        setResult(request);
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
    [client, walletAddresses],
  );

  const reset = useCallback(() => {
    seqRef.current++;
    pendingRef.current = false;
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return {
    walletAddresses,
    canProveOwnership: isAuthenticated,
    status,
    result,
    error,
    submit,
    reset,
  };
}
