import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";

export type AssetOption =
  | { type: "zeld" }
  | { type: "counterparty"; assetName: string }
  | { type: "ordinal"; inscriptionId: string; utxoId: string };

export const zeldOption: AssetOption = { type: "zeld" };

interface UseAssetsResult {
  zeldOption: AssetOption;
  counterpartyAssets: AssetOption[];
  ordinals: AssetOption[];
  isLoadingOrdinals: boolean;
  ordinalsError: Error | null;
  searchCounterparty: (query: string) => void;
  isSearching: boolean;
  counterpartyError: Error | null;
}

interface OrdInscriptionWire {
  inscription_id: string;
  owner_output: string;
}

function parseOrdInscriptions(raw: unknown): AssetOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AssetOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { inscription_id, owner_output } = item as Partial<OrdInscriptionWire>;
    if (typeof inscription_id !== "string" || typeof owner_output !== "string")
      continue;
    out.push({ type: "ordinal", inscriptionId: inscription_id, utxoId: owner_output });
  }
  return out;
}

export function useAssets(options?: {
  /** Debounce delay for counterparty search in milliseconds (default 250). */
  debounceMs?: number;
}): UseAssetsResult {
  const { client, addresses, ordApiBaseUrl, fetch } = useHorizonMarket();
  const debounceMs = options?.debounceMs ?? 250;

  const [counterpartyAssets, setCounterpartyAssets] = useState<AssetOption[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);
  const [counterpartyError, setCounterpartyError] = useState<Error | null>(
    null,
  );

  const [ordinals, setOrdinals] = useState<AssetOption[]>([]);
  const [isLoadingOrdinals, setIsLoadingOrdinals] = useState(false);
  const [ordinalsError, setOrdinalsError] = useState<Error | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);

  const searchCounterparty = useCallback(
    (query: string) => {
      if (!client) return;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      const seq = ++searchSeqRef.current;
      setIsSearching(true);
      setCounterpartyError(null);
      searchTimerRef.current = setTimeout(() => {
        client
          .searchAssetNames({
            query: query || undefined,
            limit: 20,
          })
          .then((res) => {
            if (seq !== searchSeqRef.current) return;
            setCounterpartyAssets(
              res.assetNames.map((name) => ({
                type: "counterparty" as const,
                assetName: name,
              })),
            );
          })
          .catch((err: unknown) => {
            if (seq !== searchSeqRef.current) return;
            setCounterpartyError(
              err instanceof Error ? err : new Error(String(err)),
            );
          })
          .finally(() => {
            if (seq === searchSeqRef.current) setIsSearching(false);
          });
      }, debounceMs);
    },
    [client, debounceMs],
  );

  // Cancel any pending debounced search on unmount.
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  // Ordinals load from ord API
  useEffect(() => {
    const taprootAddr = addresses?.p2tr;
    if (!taprootAddr || !ordApiBaseUrl) {
      setOrdinals([]);
      return;
    }
    let cancelled = false;
    setIsLoadingOrdinals(true);
    setOrdinalsError(null);

    fetch(
      `${ordApiBaseUrl.replace(/\/$/, "")}/address/${encodeURIComponent(
        taprootAddr,
      )}`,
      { headers: { Accept: "application/json" } },
    )
      .then(async (res) => {
        if (!res.ok)
          throw new Error(`Ord API returned ${res.status}: ${res.statusText}`);
        return (await res.json()) as unknown;
      })
      .then((raw) => {
        if (cancelled) return;
        setOrdinals(parseOrdInscriptions(raw));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOrdinalsError(
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOrdinals(false);
      });

    return () => {
      cancelled = true;
    };
  }, [addresses, ordApiBaseUrl, fetch]);

  return {
    zeldOption,
    counterpartyAssets,
    ordinals,
    isLoadingOrdinals,
    ordinalsError,
    searchCounterparty,
    isSearching,
    counterpartyError,
  };
}
