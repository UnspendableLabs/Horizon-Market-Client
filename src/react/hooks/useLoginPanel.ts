import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket, type Addresses } from "../context.js";

export type LoginPanelPhase = "form" | "verifying" | "success" | "error";

export interface UseLoginPanelOptions {
  getPrivateKey: (email: string) => Promise<string>;
  autoDetectSession?: boolean;
  onSuccess?: (addresses: Addresses) => void;
  onError?: (error: Error) => void;
}

export interface UseLoginPanelResult {
  email: string;
  setEmail: (v: string) => void;
  phase: LoginPanelPhase;
  error: Error | null;
  addresses: Addresses | null;
  connect: () => void;
}

/**
 * Shared login lifecycle for the platform-specific `LoginPanel` components.
 *
 * - On mount (when `autoDetectSession`), probes `getPrivateKey("")` to pick up
 *   an existing session (e.g. after a Web3Auth redirect).
 * - `connect()` runs the interactive flow with the current `email`.
 * - Fires `onSuccess` exactly once per successful login, even if the consumer
 *   passes an inline (un-memoized) callback.
 */
export function useLoginPanel({
  getPrivateKey,
  autoDetectSession = true,
  onSuccess,
  onError,
}: UseLoginPanelOptions): UseLoginPanelResult {
  const { initialize, addresses } = useHorizonMarket();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<LoginPanelPhase>("form");
  const [error, setError] = useState<Error | null>(null);

  const callbacksRef = useRef({ onSuccess, onError });
  callbacksRef.current = { onSuccess, onError };
  const firedSuccessForRef = useRef<Addresses | null>(null);

  const run = useCallback(
    async (probe: boolean) => {
      setError(null);
      setPhase("verifying");
      try {
        const key = await getPrivateKey(probe ? "" : email);
        if (!key) {
          if (probe) {
            setPhase("form");
            return;
          }
          throw new Error("No private key returned");
        }
        initialize(key);
        setPhase("success");
      } catch (err) {
        if (probe) {
          setPhase("form");
          return;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setPhase("error");
        callbacksRef.current.onError?.(e);
      }
    },
    [email, getPrivateKey, initialize],
  );

  // Probe for an existing session exactly once. The ref gate prevents re-probing
  // when `run` changes (e.g. as the user types into the email input).
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current) return;
    if (!autoDetectSession) return;
    probedRef.current = true;
    if (addresses) {
      setPhase("success");
      return;
    }
    void run(true);
  }, [autoDetectSession, addresses, run]);

  // Reset to the form when the user logs out.
  useEffect(() => {
    if (addresses) return;
    setPhase("form");
    setError(null);
    firedSuccessForRef.current = null;
  }, [addresses]);

  // Fire onSuccess exactly once per success transition, regardless of whether
  // the consumer memoizes the callback.
  useEffect(() => {
    if (phase !== "success" || !addresses) return;
    if (firedSuccessForRef.current === addresses) return;
    firedSuccessForRef.current = addresses;
    callbacksRef.current.onSuccess?.(addresses);
  }, [phase, addresses]);

  const connect = useCallback(() => {
    void run(false);
  }, [run]);

  return { email, setEmail, phase, error, addresses, connect };
}
