/**
 * Tiny imperative bridge so the (non-React) Web3Auth flow can tell the
 * AppLockProvider that the user just satisfied an OS auth OUTSIDE the app-lock gate.
 *
 * When that happens the app-lock counts as satisfied for this session — we don't
 * want to prompt Face ID again on top of it. Two callers fire it: an interactive
 * login (email passwordless via the system browser), and a cold-start restore that
 * unsealed the auth-gated cached key (that keystore read itself prompts for
 * biometrics — see secure-key-store.ts). A restore that instead reconnects through
 * Web3Auth (no cached key) does NOT fire it, so that path still requires biometrics.
 *
 * Kept separate from lib/app-lock.ts on purpose: importing this must NOT pull in
 * expo-local-authentication (web3auth.ts imports it, and the OS module has no
 * business in that graph).
 */
let freshLoginHandler: (() => void) | null = null;

/** Register the AppLockProvider's "treat as unlocked" handler; returns an unsubscribe. */
export function onFreshLogin(handler: () => void): () => void {
  freshLoginHandler = handler;
  return () => {
    if (freshLoginHandler === handler) freshLoginHandler = null;
  };
}

/** Called right after an interactive login OR an auth-gated key restore succeeds. */
export function markFreshLogin(): void {
  freshLoginHandler?.();
}
