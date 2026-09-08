import type { HttpClient } from "./http.js";
import type {
  AccountDeletionRequest,
  AccountDeletionRequestParams,
  RequestOptions,
} from "../types/index.js";

/** Maximum length the server accepts for `message`. */
export const ACCOUNT_DELETION_MESSAGE_MAX_LENGTH = 2000;

/** Maximum number of addresses one request may name. */
export const ACCOUNT_DELETION_MAX_ADDRESSES = 20;

// ─── Wire types (internal) ────────────────────────────────────────────────────

interface WireAccountDeletionRequest {
  id?: string;
  status: "pending";
  duplicate?: boolean;
  verified?: boolean;
}

// ─── POST /api/account-deletion-requests ──────────────────────────────────────

/**
 * POST /api/account-deletion-requests — ask for an account and the personal
 * data attached to it to be deleted.
 *
 * **Not session-gated**: App Store guideline 5.1.1(v) requires the option to be
 * reachable, and the person asking may have lost the wallet or the mailbox the
 * account was made with. So the request names the account by email, by the
 * addresses it connected, or both, and an admin matches it to a user before
 * anything is deleted.
 *
 * A session is still worth having when there is one. The server reads the
 * bearer token this client attaches after `signInWithWallet()`, and a request
 * whose identity the session owns is recorded as *proven* — which is what lets
 * it take over a pending request somebody else filed for the same identity.
 * Nothing about signing in is required, and signing in as somebody else proves
 * nothing.
 *
 * Asking twice for one identity is not an error: the server answers 200 with
 * `duplicate: true` and the standing request keeps its place in the queue.
 * Both outcomes map to one {@link AccountDeletionRequest}.
 */
export async function requestAccountDeletion(
  http: HttpClient,
  params: AccountDeletionRequestParams,
  options?: RequestOptions,
): Promise<AccountDeletionRequest> {
  const email = params.email?.trim();
  const message = params.message?.trim();
  const addresses = normalizeAccountDeletionAddresses(params.addresses ?? []);

  if (!email && addresses.length === 0) {
    throw new Error(
      "Give the email or at least one address of the account to delete",
    );
  }

  const wire = await http.request<WireAccountDeletionRequest>(
    "POST",
    "/api/account-deletion-requests",
    {
      ...(email ? { email } : {}),
      ...(addresses.length > 0 ? { addresses } : {}),
      ...(message ? { message } : {}),
    },
    options?.signal,
  );

  return {
    id: wire.id ?? null,
    status: wire.status,
    duplicate: wire.duplicate === true,
    verified: typeof wire.verified === "boolean" ? wire.verified : null,
  };
}

/**
 * Split a free-text address field — one per line, or comma/semicolon separated —
 * into the list `requestAccountDeletion` takes. Trims, drops blanks, and keeps
 * the order they were typed in.
 */
export function parseAccountDeletionAddresses(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * Deduplicate a list of addresses, preserving order.
 *
 * Case is deliberately left alone: the server folds it for the uniqueness key,
 * but the addresses it stores are what an admin reads next to an account, and
 * base58 (legacy, P2SH) is case-*sensitive* — lowercasing one would put an
 * address in front of an admin that the account never had.
 */
function normalizeAccountDeletionAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of addresses) {
    const trimmed = address.trim();
    if (!trimmed) continue;
    // Fold only for the duplicate test: bech32 is case-insensitive, so the same
    // wallet typed twice in different cases is one address, not two.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
