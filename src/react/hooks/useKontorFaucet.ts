import { useCallback, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import {
  KONTOR_FAUCET_AMOUNT_KOR,
  type KontorFaucetResult,
} from "../../kontor/faucet.js";

export type KontorFaucetStatus = "idle" | "requesting" | "success" | "error";

export interface UseKontorFaucetResult {
  /**
   * True when a request can be made at all: the provider is on Kontor signet and
   * the connected wallet exposes the taproot key the faucet credits. Render your
   * faucet control on this — mainnet has no faucet, and a disabled button there
   * would advertise free coins that don't exist.
   */
  available: boolean;
  /** KOR one request grants. */
  amountKor: number;
  status: KontorFaucetStatus;
  /** The faucet's two txids once it accepted, else null. */
  result: KontorFaucetResult | null;
  /** Why the faucet turned the request down, else null. */
  error: Error | null;
  /**
   * Ask for KOR. Never rejects — the outcome lands in `status` / `result` /
   * `error`, so a click handler needs no try/catch. Ignored while a request is
   * already in flight.
   */
  request: () => Promise<void>;
  /** Back to `idle`, clearing the last result/error (e.g. when reopening a dialog). */
  reset: () => void;
}

/**
 * The signet KOR faucet, as a hook.
 *
 * Kontor charges gas in KOR and drops the operation of an account holding none,
 * so a signet wallet with an empty KOR balance can do nothing on Kontor — and
 * can't buy KOR either, because that purchase would itself need gas. The faucet
 * is the only way in, which is why this is packaged rather than left to hosts.
 *
 * Nothing here loads `@kontor/sdk`: the request is plain HTTP, so the faucet
 * works in a WASM-free web bundle and on a React Native build that never linked
 * `@kontor/sdk-native` — the same builds where every *other* Kontor call fails,
 * and where a user most needs to fund an account and try again.
 *
 * The KOR lands when the faucet's reveal transaction confirms — about a block
 * later, not on success — so this deliberately does not refresh balances. Call
 * `refreshBalances()` from the provider when the user dismisses your success UI.
 */
export function useKontorFaucet(): UseKontorFaucetResult {
  const { client, addresses, network, kontorNetwork } = useHorizonMarket();

  const available =
    kontorNetwork === "signet" &&
    network === "testnet" &&
    Boolean(addresses?.xOnlyPubkey);

  const [status, setStatus] = useState<KontorFaucetStatus>("idle");
  const [result, setResult] = useState<KontorFaucetResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Bumped by every request and by reset(); a response whose sequence is stale
  // (the wallet disconnected, the dialog was reopened) is dropped rather than
  // painted over whatever the user is looking at now.
  const seqRef = useRef(0);
  const pendingRef = useRef(false);

  const request = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const seq = ++seqRef.current;
    setStatus("requesting");
    setResult(null);
    setError(null);
    try {
      const res = await client.requestKontorFaucet();
      if (seq !== seqRef.current) return;
      setResult(res);
      setStatus("success");
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
    } finally {
      pendingRef.current = false;
    }
  }, [client]);

  const reset = useCallback(() => {
    seqRef.current++;
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return {
    available,
    amountKor: KONTOR_FAUCET_AMOUNT_KOR,
    status,
    result,
    error,
    request,
    reset,
  };
}
