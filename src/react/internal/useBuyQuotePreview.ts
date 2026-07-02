import { useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type { AtomicSwap, BuyQuoteParams } from "../../types/index.js";

/** Exact per-buy costs read from a composed (but unsigned) buyer PSBT. */
export interface BuyQuotePreviewResult {
  /** Miner fee of the buyer transaction in sats. */
  minerFeeSats: number | null;
  /** Creator royalty in sats (0 when the listing has none). */
  royaltySats: number | null;
  loading: boolean;
  error: Error | null;
}

const IDLE: BuyQuotePreviewResult = {
  minerFeeSats: null,
  royaltySats: null,
  loading: false,
  error: null,
};

/**
 * Side-effect-free cost preview for a purchase. Composes the real buyer PSBT via
 * the buy-quote endpoint (server selects funding UTXOs and estimates the miner
 * fee) so the review can show exact numbers before the user commits — nothing is
 * signed or broadcast. Debounced; re-quotes when the swap or fee rate changes and
 * discards stale responses.
 *
 * Returns idle for Kontor listings (no buy-quote endpoint — the buyer commit +
 * swap reveal are composed locally by the Kontor SDK only at accept time) and
 * when disabled, the client is unauthenticated, or (for ordinals) no taproot
 * receive address is available.
 */
export function useBuyQuotePreview(
  swap: AtomicSwap,
  satsPerVbyte: number | undefined,
  enabled: boolean,
): BuyQuotePreviewResult {
  const { client, addresses } = useHorizonMarket();
  const [state, setState] = useState<BuyQuotePreviewResult>(IDLE);

  const isKontor = swap.listingType === "kontor";
  const isOrdinal = swap.listingType === "ordinal";
  const buyerAddress = addresses?.p2wpkh ?? null;
  // Ordinals must be received on a taproot address; without one the quote can't
  // be composed, so stay idle rather than send a request guaranteed to fail.
  const buyerTaproot = isOrdinal ? addresses?.p2tr ?? null : null;

  const active =
    enabled &&
    !isKontor &&
    !!client &&
    !!buyerAddress &&
    (!isOrdinal || !!buyerTaproot);

  // Everything that should trigger a re-quote, as a primitive key so the effect's
  // dep array stays stable.
  const key = active
    ? JSON.stringify({
        swapId: swap.id,
        buyerAddress,
        buyerTaproot,
        satsPerVbyte: satsPerVbyte ?? null,
      })
    : null;

  const clientRef = useRef(client);
  clientRef.current = client;
  const seqRef = useRef(0);

  useEffect(() => {
    if (key === null) {
      setState(IDLE);
      return;
    }

    const { swapId, buyerAddress, buyerTaproot, satsPerVbyte } = JSON.parse(
      key,
    ) as {
      swapId: string;
      buyerAddress: string;
      buyerTaproot: string | null;
      satsPerVbyte: number | null;
    };

    const seq = ++seqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const c = clientRef.current;
      if (!c) return;
      const params: BuyQuoteParams = {
        swapIds: [swapId],
        buyerAddress,
        autoSelect: true,
        detach: true,
        ...(buyerTaproot ? { buyerTaprootAddress: buyerTaproot } : {}),
        ...(satsPerVbyte != null ? { satsPerVbyte } : {}),
      };
      c.requestBuyQuote(params, { signal: controller.signal })
        .then((q) => {
          if (seq !== seqRef.current) return;
          setState({
            minerFeeSats: q.feeEstimateSats,
            royaltySats: q.royaltySats,
            loading: false,
            error: null,
          });
        })
        .catch((err) => {
          if (seq !== seqRef.current || controller.signal.aborted) return;
          setState({
            minerFeeSats: null,
            royaltySats: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return state;
}
