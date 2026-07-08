import { CliError } from "./output.js";

/**
 * ord server reads — the CLI port of `useAssets`' `fetchOrdinals`. The
 * `/address/{addr}` response lists inscription-id strings; the holding UTXO is
 * resolved per inscription via `/inscription/{id}` (its `satpoint` → `txid:vout`).
 */

/** A resolved inscription: its id, holding UTXO (`txid:vout`), and holding address. */
export interface OrdinalUtxo {
  inscriptionId: string;
  utxoId: string;
  address: string;
}

function extractInscriptionIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const { inscriptions } = raw as { inscriptions?: unknown };
  if (!Array.isArray(inscriptions)) return [];
  return inscriptions.filter((x): x is string => typeof x === "string");
}

/** A `satpoint` is `txid:vout:offset`; the holding UTXO id is `txid:vout`. */
function satpointToUtxoId(satpoint: unknown): string | null {
  if (typeof satpoint !== "string") return null;
  const lastColon = satpoint.lastIndexOf(":");
  if (lastColon <= 0) return null;
  return satpoint.slice(0, lastColon);
}

async function inscriptionUtxo(
  fetchImpl: typeof globalThis.fetch,
  ordRoot: string,
  id: string,
): Promise<string | null> {
  const res = await fetchImpl(`${ordRoot}/inscription/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Ord API returned ${res.status} for inscription ${id}`);
  const body = (await res.json()) as { satpoint?: unknown };
  return satpointToUtxoId(body.satpoint);
}

/** Enumerate every inscription the wallet holds across `addresses`. */
export async function fetchInscriptionUtxos(
  fetchImpl: typeof globalThis.fetch,
  ordApiBaseUrl: string | undefined,
  addresses: string[],
): Promise<OrdinalUtxo[]> {
  const ordRoot = ordApiBaseUrl?.replace(/\/$/, "");
  if (!ordRoot) return [];
  const lists = await Promise.all(
    addresses.map(async (addr) => {
      const res = await fetchImpl(`${ordRoot}/address/${encodeURIComponent(addr)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Ord API returned ${res.status} for ${addr}`);
      const ids = extractInscriptionIds(await res.json());
      const resolved = await Promise.all(
        ids.map(async (id): Promise<OrdinalUtxo | null> => {
          const utxoId = await inscriptionUtxo(fetchImpl, ordRoot, id);
          return utxoId ? { inscriptionId: id, utxoId, address: addr } : null;
        }),
      );
      return resolved.filter((x): x is OrdinalUtxo => x !== null);
    }),
  );
  return lists.flat();
}

/** Resolve a single inscription id to its holding UTXO (`txid:vout`). */
export async function resolveInscriptionUtxo(
  fetchImpl: typeof globalThis.fetch,
  ordApiBaseUrl: string | undefined,
  inscriptionId: string,
): Promise<string> {
  const ordRoot = ordApiBaseUrl?.replace(/\/$/, "");
  if (!ordRoot) {
    throw new CliError("No ord API base URL configured for this network", "NO_ORD_API");
  }
  const utxoId = await inscriptionUtxo(fetchImpl, ordRoot, inscriptionId);
  if (!utxoId) {
    throw new CliError(`Could not resolve inscription ${inscriptionId}`, "INSCRIPTION_UNRESOLVED");
  }
  return utxoId;
}

/** Best-effort list of inscription UTXO ids to protect from plain-BTC spending. */
export async function protectedUtxoIds(
  fetchImpl: typeof globalThis.fetch,
  ordApiBaseUrl: string | undefined,
  addresses: string[],
): Promise<string[]> {
  try {
    return (await fetchInscriptionUtxos(fetchImpl, ordApiBaseUrl, addresses)).map(
      (o) => o.utxoId,
    );
  } catch {
    // Non-fatal: without the ord server we just can't pre-exclude inscriptions.
    return [];
  }
}
