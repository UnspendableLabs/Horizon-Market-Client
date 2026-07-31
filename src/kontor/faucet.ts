/**
 * The signet KOR faucet.
 *
 * Every Kontor operation pays gas in KOR, and an account holding none has its op
 * dropped before execution — so a signet wallet with an empty KOR balance can't
 * do anything on Kontor until someone funds it. The Portal runs a public faucet
 * (`POST {portal}/api/faucet`) for exactly that, and horizon.market proxies it at
 * `{baseUrl}/api/kontor-faucet` (the proxy is signet-only and 404s elsewhere),
 * which is what this module talks to by default.
 *
 * Deliberately free of any `@kontor/sdk` import, static or dynamic: this is a
 * plain `fetch`, so it works in a bundle built to keep the Kontor WebAssembly
 * backend out, and on a React Native build that never linked `@kontor/sdk-native`.
 * Funding an account is the one Kontor errand that must not require the Kontor
 * runtime — it is what you do *before* anything else works.
 */

/** KOR granted per faucet request (what the public Portal faucet hands out). */
export const KONTOR_FAUCET_AMOUNT_KOR = 10;

/** The faucet's two Bitcoin transactions; the KOR lands when the reveal confirms. */
export interface KontorFaucetResult {
  /** Txid of the faucet's commit transaction, or "" if the Portal omits it. */
  commitTxid: string;
  /** Txid of the reveal — the KOR is credited once this confirms (about a block). */
  revealTxid: string;
}

export interface RequestKontorFaucetParams {
  /** Faucet endpoint, e.g. `https://signet.horizon.market/api/kontor-faucet`. */
  url: string;
  /**
   * The 64-hex **x-only taproot public key** the token contract credits — not an
   * address. This is `getAddresses().xOnlyPubkey`.
   */
  recipient: string;
  /** KOR to request. Defaults to {@link KONTOR_FAUCET_AMOUNT_KOR}. */
  amount?: number;
  fetch: typeof globalThis.fetch;
}

/** Raw faucet response — snake_case, passed through from the Portal. */
interface FaucetResponse {
  commit_txid?: string;
  reveal_txid?: string;
  error?: { message?: string } | null;
}

/**
 * Ask the faucet for KOR, resolving with the two txids it broadcast.
 *
 * Throws with the faucet's own message when it turns the request down
 * (`INVALID_REQUEST`, `FAUCET_FAILED`, `FAUCET_UNAVAILABLE`, a rate limit): the
 * upstream reason is the only thing that tells the user whether to retry, wait,
 * or give up, so it is surfaced verbatim rather than replaced with a generic one.
 */
export async function requestKontorFaucet(
  params: RequestKontorFaucetParams,
): Promise<KontorFaucetResult> {
  const { url, recipient, amount = KONTOR_FAUCET_AMOUNT_KOR, fetch } = params;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient, amount }),
  });

  // A faucet behind a proxy can answer with HTML (a 404 page, a gateway error),
  // so a body that isn't JSON must not mask the status the caller needs to see.
  const data = (await res
    .json()
    .catch(() => null)) as FaucetResponse | null;

  if (!res.ok) {
    throw new Error(
      data?.error?.message ?? `Faucet request failed (HTTP ${res.status})`,
    );
  }

  return {
    commitTxid: data?.commit_txid ?? "",
    revealTxid: data?.reveal_txid ?? "",
  };
}
