import { HttpClient, HorizonMarketApiError } from "./http.js";

// ─── Wallet challenge ──────────────────────────────────────────────────────────

/** BIP322 challenge returned by `POST /api/auth/wallet/challenges`. */
export interface WalletChallenge {
  nonce: string;
  /** Exact string to BIP322-sign with the wallet address. */
  message: string;
}

/**
 * POST /api/auth/wallet/challenges — request a nonce-bearing message to sign.
 *
 * Sends only the public Bitcoin address. The returned `message` must be signed
 * (BIP322) with that address to complete sign-in.
 */
export async function requestWalletChallenge(
  http: HttpClient,
  address: string,
): Promise<WalletChallenge> {
  return http.request<WalletChallenge>("POST", "/api/auth/wallet/challenges", {
    address,
  });
}

// ─── Credentials sign-in (Auth.js v5) ───────────────────────────────────────────

export interface WalletSignInParams {
  address: string;
  /** BIP322 signature over the challenge `message`. */
  signature: string;
  nonce: string;
  /** Wallet provider label recorded server-side (required by the WALLET provider). */
  walletProvider: string;
  /** Optional P2TR address linked to the account (e.g. for ordinal receipt). */
  taprootAddress?: string;
}

/**
 * Complete the NextAuth (Auth.js v5) credentials sign-in for the `WALLET` provider.
 *
 * 1. `GET /api/auth/csrf` → CSRF token (also sets the `authjs.csrf-token` cookie,
 *    captured by the {@link HttpClient}).
 * 2. `POST /api/auth/callback/WALLET` (form-urlencoded) → on success the response
 *    sets the `authjs.session-token` cookie, which the client captures and attaches
 *    to subsequent requests so the server can waive the platform fee (credits /
 *    subscription).
 *
 * **Node / server contexts only:** the callback is not CORS-open and `Set-Cookie`
 * is inaccessible to cross-origin browser JS. In a same-origin browser app, rely on
 * the website's existing session instead.
 *
 * @throws {HorizonMarketApiError} when no session is established (e.g. an invalid
 * signature or an expired/used challenge).
 */
export async function completeWalletSignIn(
  http: HttpClient,
  params: WalletSignInParams,
): Promise<void> {
  // 1. CSRF token (also sets the authjs.csrf-token cookie, auto-captured).
  const csrfRes = await http.fetchRaw("GET", "/api/auth/csrf", {
    headers: { Accept: "application/json" },
  });
  const csrfBody = (await csrfRes.json().catch(() => null)) as {
    csrfToken?: string;
  } | null;
  const csrfToken = csrfBody?.csrfToken;
  if (!csrfToken) {
    throw new HorizonMarketApiError(
      csrfRes.status,
      "Wallet sign-in failed: could not obtain a CSRF token from /api/auth/csrf",
    );
  }

  // 2. Credentials callback for the WALLET provider.
  const form = new URLSearchParams({
    csrfToken,
    callbackUrl: "/",
    json: "true",
    address: params.address,
    signature: params.signature,
    nonce: params.nonce,
    wallet_provider: params.walletProvider,
  });
  if (params.taprootAddress) {
    form.set("taproot_address", params.taprootAddress);
  }

  const callbackRes = await http.fetchRaw("POST", "/api/auth/callback/WALLET", {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      // Ask Auth.js to return JSON instead of issuing a 302 redirect.
      "X-Auth-Return-Redirect": "1",
    },
    body: form.toString(),
    // Capture Set-Cookie on the immediate response rather than following redirects.
    redirect: "manual",
  });

  if (!http.hasSessionCookie()) {
    let detail = `HTTP ${callbackRes.status}`;
    try {
      const body = (await callbackRes.json()) as { url?: string };
      if (body?.url) detail = body.url;
    } catch {
      // no body / not JSON
    }
    throw new HorizonMarketApiError(
      callbackRes.status >= 400 ? callbackRes.status : 401,
      `Wallet sign-in failed: no session established (${detail})`,
    );
  }
}

// ─── Session introspection ───────────────────────────────────────────────────

/** Authenticated user info from `GET /api/auth/session`. */
export interface SessionInfo {
  id: string;
  address?: string;
  email?: string | null;
}

/**
 * GET /api/auth/session — read the current NextAuth session (no `{ data }`
 * envelope). Returns `null` when unauthenticated.
 */
export async function getSession(
  http: HttpClient,
): Promise<SessionInfo | null> {
  const res = await http.fetchRaw("GET", "/api/auth/session", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    user?: { id?: string; address?: string; email?: string | null };
  } | null;
  if (!body?.user?.id) return null;
  return {
    id: body.user.id,
    address: body.user.address,
    email: body.user.email ?? null,
  };
}
