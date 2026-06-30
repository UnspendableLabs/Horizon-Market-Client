import { useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";

export interface KontorListingFeeResult {
  /** Listing fee in sats (null until loaded / on failure). */
  listingSats: number | null;
  loading: boolean;
  error: Error | null;
}

const IDLE: KontorListingFeeResult = {
  listingSats: null,
  loading: false,
  error: null,
};

/**
 * Side-effect-free preview of the Kontor listing fee (sats) for `address`. Uses
 * the server's `preview` mode so the review screen can show the real fee without
 * reserving an OnChainPayment. Idle when disabled or `address` is null.
 */
export function useKontorListingFee(
  address: string | null,
  enabled: boolean,
): KontorListingFeeResult {
  const { client } = useHorizonMarket();
  const [state, setState] = useState<KontorListingFeeResult>(IDLE);
  const seqRef = useRef(0);

  const active = enabled && !!address && !!client;

  useEffect(() => {
    if (!active || !address || !client) {
      setState(IDLE);
      return;
    }
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    client
      .previewKontorListingFee(address, { signal: controller.signal })
      .then((sats) => {
        if (seq !== seqRef.current) return;
        setState({ listingSats: sats, loading: false, error: null });
      })
      .catch((err) => {
        if (seq !== seqRef.current || controller.signal.aborted) return;
        setState({
          listingSats: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => {
      controller.abort();
    };
  }, [active, address, client]);

  return state;
}
