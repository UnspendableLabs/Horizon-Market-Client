/**
 * Routing between a {@link TokenRef} and the `/token/[protocol]/[id]` screen.
 *
 * One place for the mapping, so the Buy list, the search results and any future
 * entry point all land on the same route for the same token — and so the screen
 * itself has one way to read its params back.
 */
import type { TokenProtocol, TokenRef } from "@unspendablelabs/horizon-market-client/react";

const PROTOCOLS: TokenProtocol[] = [
  "counterparty",
  "zeld",
  "ordinals",
  "kontor",
  "kontor-nft",
];

/** Where the user came from — carried so analytics can tell the paths apart. */
export type TokenOrigin = "buy_list" | "search" | "direct";

/**
 * The route for a token. The id is encoded because it is a single path segment
 * and a Counterparty subasset longname (`PARENT.child`) or an inscription id is
 * not guaranteed to be URL-clean.
 */
export function tokenHref(ref: TokenRef, from?: TokenOrigin): string {
  const path = `/token/${ref.protocol}/${encodeURIComponent(ref.id)}`;
  return from ? `${path}?from=${from}` : path;
}

/** The entry point recorded on the route, defaulting to a direct/deep link. */
export function tokenOriginFromRoute(
  from?: string | string[],
): TokenOrigin {
  const value = Array.isArray(from) ? from[0] : from;
  return value === "buy_list" || value === "search" ? value : "direct";
}

/**
 * Read a {@link TokenRef} back out of the route params, or `null` when the
 * protocol segment is not one this app knows — a hand-typed deep link should
 * land on "not found" rather than on a request for a nonexistent endpoint.
 *
 * expo-router already percent-decodes the segment, so nothing is decoded here:
 * doing it twice would corrupt an id that legitimately contains a `%`.
 */
export function tokenRefFromRoute(params: {
  protocol?: string | string[];
  id?: string | string[];
}): TokenRef | null {
  const protocol = Array.isArray(params.protocol)
    ? params.protocol[0]
    : params.protocol;
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!protocol || !id) return null;
  if (!PROTOCOLS.includes(protocol as TokenProtocol)) return null;
  return { protocol: protocol as TokenProtocol, id };
}
