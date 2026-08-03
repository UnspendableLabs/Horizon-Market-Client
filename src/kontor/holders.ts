import * as btc from "bitcoinjs-lib";
import { HolderRef } from "@kontor/sdk";

/**
 * Holder resolution for Kontor KOR/NFT holdings, ported from the Horizon-Market
 * server's `kontor-nfts-client.tsx`.
 *
 * The contracts index a holder by a `HolderRef`, which is one of:
 *  - an `x-only-pubkey` — the session's internal signing key OR the bech32m
 *    tweaked taproot output key (they differ; both are queried), used for
 *    *unregistered* signers; or
 *  - a `signer-id` — a signer **registered on-chain**. A wallet gets a signer-id
 *    the first time it *sponsors* a Kontor tx (every buy/sell/mint does — and any
 *    credit, e.g. a faucet transfer, creates the identity row too), and its
 *    holdings are then credited to `signer-id(N)`. The runtime *canonicalizes*
 *    an x-only holder-ref to its signer-id before reading the ledger, so
 *    querying a registered key under both refs returns the same row twice.
 *
 * So we resolve the wallet's registered signer-id from the Kontor indexer
 * (`GET {indexerUrl}/signers/{x-only}`) and query it alongside the x-only
 * candidates, unioning the results. (The Horizon server does the equivalent via
 * its `/api/kontor-signer/{addr}` proxy; the SDK talks to the indexer directly,
 * so no Horizon-specific endpoint is needed.)
 */

/** Raw shape of the Kontor indexer's `/signers/{identifier}` response. */
interface SignerLookupResponse {
  result?: { signer_id?: number | null } | null;
}

/**
 * Resolve a wallet's registered Kontor `signer-id` from an x-only pubkey via the
 * indexer's reverse index (`GET {indexerUrl}/signers/{xOnlyPubkey}`). Returns the
 * numeric signer-id, or null when the signer is unregistered (404 / not-found) or
 * on any network/parse failure — callers fall back to the x-only holder candidates.
 */
export async function resolveSignerId(
  indexerUrl: string,
  xOnlyPubkey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<number | null> {
  const base = indexerUrl.replace(/\/+$/, "");
  const key = xOnlyPubkey.toLowerCase().replace(/^0x/, "");
  try {
    const res = await fetchImpl(`${base}/signers/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as SignerLookupResponse;
    const id = data.result?.signer_id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

/** Decode the x-only witness program (tweaked output key) from a P2TR address. */
export function xOnlyFromTaprootAddress(address: string): string | null {
  try {
    const decoded = btc.address.fromBech32(address);
    // Taproot is witness version 1 with a 32-byte program (the output key).
    if (decoded.version !== 1 || decoded.data.length !== 32) return null;
    return Buffer.from(decoded.data).toString("hex");
  } catch {
    return null;
  }
}

/**
 * Build the union of holder candidates to query KOR/NFT holdings against:
 *  - the resolved registered `signer-id` (if any — where a registered wallet's
 *    holdings actually live), then
 *  - the session's internal signing key (`sessionXOnly`) and the bech32m-tweaked
 *    taproot output key derived from `taprootAddress`.
 * Deduplicated by x-only hex; the signer-id (when present) is always included first.
 *
 * **The candidates must be disjoint ledger rows, because callers SUM across
 * them.** The Kontor runtime canonicalizes an `x-only-pubkey` holder-ref to its
 * registered `signer-id` before touching the ledger (`Holder::from_holder_ref`,
 * in view frames too), so once `signerId` is resolved — and it is resolved from
 * `sessionXOnly` via the indexer's reverse index — `balance(sessionXOnly)` and
 * `balance(signer-id(N))` read the SAME row. Querying both double-counted every
 * registered wallet's KOR (a 10 KOR faucet grant displayed as 20), so the
 * session key is a candidate only while there is no signer-id to alias to. It
 * is still marked seen either way, so a taproot output key that happens to
 * equal it cannot smuggle the aliased row back in.
 */
export function holderCandidates(
  sessionXOnly: string,
  taprootAddress: string | undefined,
  signerId?: number | null,
): HolderRef[] {
  const candidates: HolderRef[] = [];

  const seen = new Set<string>();
  const addXOnly = (h: string | null | undefined) => {
    if (!h) return;
    const key = h.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(HolderRef.xOnlyPubkey(key));
  };

  if (signerId != null) {
    candidates.push(HolderRef.signerId(BigInt(signerId)));
    // The signer-id already covers the session key's ledger row (see above).
    if (sessionXOnly) seen.add(sessionXOnly.toLowerCase());
  } else {
    addXOnly(sessionXOnly);
  }
  if (taprootAddress) addXOnly(xOnlyFromTaprootAddress(taprootAddress));

  return candidates;
}
