import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  TokenProtocol,
  TokenSearchSourceStatus,
  TokenSummary,
} from "../../api/tokens.js";

/**
 * Debounced autocomplete over `GET /api/tokens/search` — one query across all
 * five asset types.
 *
 * Each result carries the identity `client.getToken()` needs, so a keystroke
 * reaches a token screen with no client-side knowledge of protocol URL shapes.
 *
 * Two limits are the server's, not this hook's, and are worth surfacing in a UI:
 * a Kontor NFT is findable by its `nft_id` only, and an inscription by number or
 * id — neither has a searchable on-chain name, so a word query genuinely returns
 * nothing from those two sources.
 */

/** Long enough that a fast typist issues one request per word, not per letter. */
const DEBOUNCE_MS = 250;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseTokenSearchOptions {
  /** Page size, capped at 50 by the server. Defaults to the server's 20. */
  limit?: number;
  /** Restrict the search to these protocols. Omitted searches all five. */
  protocols?: TokenProtocol[];
  /** Only tokens with at least one open offer. */
  listedOnly?: boolean;
  /** Override the debounce window (ms). */
  debounceMs?: number;
}

export interface UseTokenSearchResult {
  /** The raw input value — feed this straight to a text field. */
  query: string;
  setQuery: (query: string) => void;
  /** Matches for the last settled query. Empty while the query is empty. */
  results: TokenSummary[];
  /** True from the first keystroke until the matching response lands. */
  loading: boolean;
  error: string | null;
  /** True when more matches exist than `limit` returned. */
  truncated: boolean;
  /**
   * True when the answer is incomplete: a source timed out or failed, or the
   * offer aggregate did (which leaves every row `listed: false` with no floor
   * price — indistinguishable from a page where nothing is listed).
   *
   * `skipped` does NOT count: it is a deterministic property of the request (a
   * protocol filter, or Kontor asked of a mainnet host), not a failure.
   */
  degraded: boolean;
  /** Per-source outcome for the last settled query, for a detailed notice. */
  sources: Record<string, TokenSearchSourceStatus>;
  /** Drop the query and every result — for a "clear" button. */
  clear: () => void;
}

export function useTokenSearch(
  options?: UseTokenSearchOptions,
): UseTokenSearchResult {
  const { client } = useHorizonMarket();
  const debounceMs = options?.debounceMs ?? DEBOUNCE_MS;
  const limit = options?.limit;
  const listedOnly = options?.listedOnly ?? false;
  // Joined so the effect keys off the protocol *set*, not the array's identity
  // (callers pass a literal, which is a new array every render).
  const protocolKey = (options?.protocols ?? []).join(",");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [sources, setSources] = useState<Record<string, TokenSearchSourceStatus>>(
    {},
  );

  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const trimmed = query.trim();

    if (trimmed === "") {
      // No request at all for an empty box — and clear immediately rather than
      // leaving the previous query's hits under a now-empty field.
      setResults([]);
      setLoading(false);
      setError(null);
      setTruncated(false);
      setDegraded(false);
      setSources({});
      return;
    }

    // Show the spinner from the first keystroke, not once the debounce fires:
    // between the two, results on screen belong to an older query.
    setLoading(true);
    setError(null);

    // Abort the in-flight request as the query moves on. The server runs five
    // upstreams under a shared deadline per call; letting superseded ones finish
    // is pure waste, and on a slow link they can land out of order.
    const controller = new AbortController();
    // `seq` alone does not cover unmount (nothing bumps it), and an aborted
    // request rejects — so an unmounting search box would report AbortError as a
    // search failure.
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .searchTokens(
          {
            query: trimmed,
            ...(limit !== undefined ? { limit } : {}),
            ...(protocolKey
              ? { protocols: protocolKey.split(",") as TokenProtocol[] }
              : {}),
            listedOnly,
          },
          { signal: controller.signal },
        )
        .then((result) => {
          if (cancelled || seq !== seqRef.current) return;
          setResults(result.results);
          setTruncated(result.truncated);
          setSources(result.sources);
          setDegraded(
            result.offers !== "ok" ||
              Object.values(result.sources).some(
                (status) => status !== "ok" && status !== "skipped",
              ),
          );
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled || seq !== seqRef.current) return;
          setError(message(err));
          setResults([]);
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, limit, protocolKey, listedOnly, debounceMs]);

  const clear = useCallback(() => setQuery(""), []);

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    truncated,
    degraded,
    sources,
    clear,
  };
}
