/**
 * Tiny imperative bridge so the (non-React) Web3Auth login flow can tell the
 * AppLockProvider that a fresh, INTERACTIVE login just happened.
 *
 * A fresh login means the user just authenticated (email passwordless via the
 * system browser), so the app-lock counts as satisfied for this session — we
 * don't want to prompt Face ID on top of a login they just completed. A session
 * *restore* at cold start does NOT go through here (it uses getPrivateKey("")),
 * so a relaunch still requires biometrics.
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

/** Called by the login flow right after an interactive login succeeds. */
export function markFreshLogin(): void {
  freshLoginHandler?.();
}
