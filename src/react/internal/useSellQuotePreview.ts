import { useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  OpenSellOrderParams,
  PsbtSellOrderParams,
} from "../../workflows/sell.js";
import type { SellQuoteParams } from "../../types/index.js";

/** Cost breakdown shown on the sell review's "You'll pay to list" section. */
export interface SellCost {
  /** Platform listing fee in sats (0 when waived). */
  listing: number;
  /** Miner fee of the asset-prep (attach / zeld transfer) tx in sats. */
  attach: number;
  /** Miner fee of the standalone platform-fee tx in sats. */
  network: number;
  /** listing + attach + network. */
  total: number;
}

export interface SellQuotePreviewResult {
  cost: SellCost | null;
  feeWaived: boolean;
  loading: boolean;
  error: Error | null;
}

const IDLE: SellQuotePreviewResult = {
  cost: null,
  feeWaived: false,
  loading: false,
  error: null,
};

// JSON.stringify can't serialize the `bigint` assetQuantity — coerce to string.
function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

function toQuoteParams(
  p: PsbtSellOrderParams,
  satsPerVbyte: number | undefined,
): SellQuoteParams {
  return {
    price: p.priceSats,
    // buildSellOrderParams always sets sellerAddress for counterparty/ordinal/zeld.
    sellerAddress: p.sellerAddress as string,
    listingType: p.listingType,
    assetUtxoId: p.assetUtxoId,
    assetName: p.assetName,
    assetQuantity: p.assetQuantity,
    autoSelectFeeUtxos: p.autoSelectFeeUtxos,
    ...(satsPerVbyte != null ? { satsPerVbyte } : {}),
    preview: true,
  };
}

/**
 * Side-effect-free cost preview for a sell listing. Debounced; re-quotes when the
 * params or fee rate change and discards stale responses. Returns idle for Kontor
 * listings (no sell-quote endpoint) and when disabled / params are null.
 */
export function useSellQuotePreview(
  params: OpenSellOrderParams | null,
  satsPerVbyte: number | undefined,
  enabled: boolean,
): SellQuotePreviewResult {
  const { client } = useHorizonMarket();
  const [state, setState] = useState<SellQuotePreviewResult>(IDLE);

  const isKontor = params?.listingType === "kontor";
  const active = enabled && !!params && !isKontor && !!client;

  // Encodes everything that should trigger a re-quote; `params`/`client` are read
  // from refs inside the effect so the dep array stays primitive.
  const key = active
    ? stableKey(toQuoteParams(params as PsbtSellOrderParams, satsPerVbyte))
    : null;

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const rateRef = useRef(satsPerVbyte);
  rateRef.current = satsPerVbyte;
  const clientRef = useRef(client);
  clientRef.current = client;
  const seqRef = useRef(0);

  useEffect(() => {
    if (key === null) {
      setState(IDLE);
      return;
    }

    const seq = ++seqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const c = clientRef.current;
      const p = paramsRef.current;
      if (!c || !p) return;
      c.requestSellQuote(
        toQuoteParams(p as PsbtSellOrderParams, rateRef.current),
        { signal: controller.signal },
      )
        .then((q) => {
          if (seq !== seqRef.current) return;
          const listing = q.listingFeeSats ?? 0;
          const attach = q.attachFeeSats ?? 0;
          const network = q.networkFeeSats ?? 0;
          setState({
            cost: { listing, attach, network, total: listing + attach + network },
            feeWaived: q.feeWaived,
            loading: false,
            error: null,
          });
        })
        .catch((err) => {
          if (seq !== seqRef.current || controller.signal.aborted) return;
          setState({
            cost: null,
            feeWaived: false,
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
