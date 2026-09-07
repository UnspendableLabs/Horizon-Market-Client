import type { HttpClient } from "./http.js";
import { listSwaps } from "./atomic-swaps.js";
import type { TokenDetail } from "./tokens.js";
import type {
  ListingReport,
  ListingReportReason,
  ReportableListingQuery,
  ReportListingParams,
  RequestOptions,
} from "../types/index.js";

// ─── Reasons ──────────────────────────────────────────────────────────────────

/**
 * Every reason `POST /api/reports` accepts, in the order a report form should
 * offer them — the concrete harms first, the catch-all last.
 */
export const LISTING_REPORT_REASONS: readonly ListingReportReason[] = [
  "scam",
  "illegal",
  "sexual",
  "violence",
  "hate",
  "impersonation",
  "spam",
  "other",
];

/** A short label for each {@link ListingReportReason}, for a report form. */
export const LISTING_REPORT_REASON_LABELS: Record<ListingReportReason, string> = {
  scam: "Scam or fraud",
  illegal: "Illegal content",
  sexual: "Sexual content",
  violence: "Violence",
  hate: "Hate or harassment",
  impersonation: "Impersonation",
  spam: "Spam",
  other: "Something else",
};

/** Maximum length the server accepts for `details`. */
export const LISTING_REPORT_DETAILS_MAX_LENGTH = 2000;

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireListingReport {
  id?: string;
  status: "pending";
  atomic_swap_id: string;
  duplicate?: boolean;
}

// ─── POST /api/reports ────────────────────────────────────────────────────────

/**
 * POST /api/reports — flag a listing for moderator review.
 *
 * **Session-gated**: the reporter has to be identifiable, so sign in first
 * (`signInWithWallet()` mints the bearer token this attaches). A 401 means no
 * session; a 404 means the swap id names nothing the server has ever stored.
 *
 * Reporting the same listing twice from one account is not an error — the
 * server answers 200 with `duplicate: true` and the original report stands.
 * Both outcomes map to one {@link ListingReport}, so a caller's success path
 * needs no branch.
 */
export async function reportListing(
  http: HttpClient,
  params: ReportListingParams,
  options?: RequestOptions,
): Promise<ListingReport> {
  const details = params.details?.trim();
  const wire = await http.request<WireListingReport>(
    "POST",
    "/api/reports",
    {
      atomic_swap_id: params.atomicSwapId,
      reason: params.reason,
      ...(details ? { details } : {}),
    },
    options?.signal,
  );

  return {
    id: wire.id ?? null,
    status: wire.status,
    atomicSwapId: wire.atomic_swap_id,
    duplicate: wire.duplicate === true,
  };
}

// ─── Token → listing resolution ───────────────────────────────────────────────

/**
 * The atomic-swap id to put on a report about a *token*, or `null` when the
 * token has never been listed on Horizon Market.
 *
 * A report targets a listing, not an asset — that is the only key that names
 * every listing type — but the screen a user reports *from* is usually the
 * token's own page, which knows the asset and nothing about swaps. This picks
 * one: an open offer first, then a completed sale, then a delisted offer, so a
 * token that was ever on the market stays reportable after its listings close.
 * The server snapshots the asset off whichever swap is named, so any of the
 * three lets a moderator act on the token itself.
 *
 * Three cheap `limit: 1` reads at most, and only when the earlier ones come back
 * empty — the common case (a token reported from its offers) is one request.
 */
export async function findReportableListingId(
  http: HttpClient,
  query: ReportableListingQuery,
  options?: RequestOptions,
): Promise<string | null> {
  // Nothing to narrow on means every listing on the market would match, and
  // reporting an arbitrary one of those is worse than reporting nothing.
  if (!query.assetName && !query.kontorNftId && !isKorQuery(query)) return null;

  const base = {
    ...(query.assetName ? { assetName: query.assetName } : {}),
    ...(query.kontorNftId ? { kontorNftId: query.kontorNftId } : {}),
    ...(query.listingType ? { listingType: query.listingType } : {}),
    ...(query.kontorAssetKind ? { kontorAssetKind: query.kontorAssetKind } : {}),
    limit: 1,
  };

  // Open offers (the server's default visibility), then sold, then delisted.
  // `sales` and an explicit `delisted` each bypass the open-offer filter on the
  // server, which is what lets the later passes see what the first could not.
  const passes = [
    base,
    { ...base, sales: true },
    { ...base, delisted: true },
  ];
  for (const params of passes) {
    const page = await listSwaps(http, params, options);
    const id = page.atomicSwaps[0]?.id;
    if (id) return id;
  }
  return null;
}

/** KOR is identified by type + kind alone — it has neither an asset name nor an NFT id. */
function isKorQuery(query: ReportableListingQuery): boolean {
  return query.listingType === "kontor" && query.kontorAssetKind === "token";
}

/**
 * The {@link ReportableListingQuery} for a token, read off the payload's own
 * `offers.atomicSwapsQuery` — the server's description of which listings are
 * *this* token's, so the report lands on the same asset the offers tab shows.
 */
export function reportableListingQueryFor(
  token: Pick<TokenDetail, "offers">,
): ReportableListingQuery {
  const q = token.offers.atomicSwapsQuery;
  return {
    ...(q.asset_name ? { assetName: q.asset_name } : {}),
    ...(q.kontor_nft_id ? { kontorNftId: q.kontor_nft_id } : {}),
    ...(q.listing_type
      ? { listingType: q.listing_type as ReportableListingQuery["listingType"] }
      : {}),
    ...(q.kontor_asset_kind
      ? {
          kontorAssetKind:
            q.kontor_asset_kind as ReportableListingQuery["kontorAssetKind"],
        }
      : {}),
  };
}
