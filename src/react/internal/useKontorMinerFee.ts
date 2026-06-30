import { useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type { KontorAssetKind } from "../../types/index.js";
import {
  FALLBACK_REVEAL_VSIZE,
  revealVsizeFromBlob,
} from "./kontorFeeEstimate.js";

export interface KontorMinerFeeResult {
  /** Attach-reveal vsize used for the estimate (measured or fallback). */
  revealVsize: number | null;
  /** True when measured from a live same-kind listing (vs the baked fallback). */
  calibrated: boolean;
  loading: boolean;
}

const IDLE: KontorMinerFeeResult = {
  revealVsize: null,
  calibrated: false,
  loading: false,
};

/**
 * Calibrate the attach-reveal vsize for `kind` by parsing a recent same-kind
 * Kontor listing's offer blob. Falls back to a baked vsize when none is found.
 * The fee in sats is then `(revealVsize + commit) × feeRate` — see
 * {@link estimateKontorMinerFee}.
 */
export function useKontorMinerFee(
  kind: KontorAssetKind | null,
  enabled: boolean,
): KontorMinerFeeResult {
  const { client } = useHorizonMarket();
  const [state, setState] = useState<KontorMinerFeeResult>(IDLE);
  const seqRef = useRef(0);

  const active = enabled && !!kind && !!client;

  useEffect(() => {
    if (!active || !kind || !client) {
      setState(IDLE);
      return;
    }
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));

    client
      .listSwaps(
        { listingType: "kontor", limit: 20 },
        { signal: controller.signal },
      )
      .then((res) => {
        if (seq !== seqRef.current) return;
        const sample = res.atomicSwaps.find(
          (s) => s.kontorAssetKind === kind && s.kontorOfferBlob,
        );
        const measured = sample?.kontorOfferBlob
          ? revealVsizeFromBlob(sample.kontorOfferBlob)
          : null;
        setState({
          revealVsize: measured ?? FALLBACK_REVEAL_VSIZE[kind],
          calibrated: measured != null,
          loading: false,
        });
      })
      .catch(() => {
        if (seq !== seqRef.current || controller.signal.aborted) return;
        setState({
          revealVsize: FALLBACK_REVEAL_VSIZE[kind],
          calibrated: false,
          loading: false,
        });
      });

    return () => {
      controller.abort();
    };
  }, [active, kind, client]);

  return state;
}
