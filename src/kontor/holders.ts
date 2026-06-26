import * as btc from "bitcoinjs-lib";
import { HolderRef } from "@kontor/sdk";

/**
 * Holder resolution for Kontor NFT ownership, ported from the Horizon-Market
 * server's `kontor-nfts-client.tsx`.
 *
 * The NFT contract indexes ownership by the `Holder` recorded at mint/transfer,
 * which may be the session's internal signing key (`x-only-pubkey`) OR the
 * bech32m-tweaked taproot output key. These differ, so we query every plausible
 * holder ref and union the results.
 *
 * NOTE: the server also resolves a registered `signer-id` via its own
 * `/api/kontor-signer/{addr}` proxy. That endpoint is Horizon-specific and not
 * part of `@kontor/sdk`, so it is intentionally omitted here — registered-signer
 * NFTs may not surface for the unauthenticated SDK consumer. This is a
 * best-effort limitation, not an error.
 */

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
 * Build the union of holder candidates to query NFT ownership against:
 * the session's internal signing key (`sessionXOnly`) and the bech32m-tweaked
 * taproot output key derived from `taprootAddress`. Deduplicated by x-only hex.
 */
export function holderCandidates(
  sessionXOnly: string,
  taprootAddress: string | undefined,
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

  addXOnly(sessionXOnly);
  if (taprootAddress) addXOnly(xOnlyFromTaprootAddress(taprootAddress));

  return candidates;
}
