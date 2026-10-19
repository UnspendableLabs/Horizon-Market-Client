import { Redirect } from "expo-router";
import { HOME_PATH } from "../lib/store-policy.js";

/**
 * Deep-link sink for the Web3Auth OAuth return.
 *
 * Web3Auth redirects the system browser back to `horizonmarket://auth` (see
 * REDIRECT_URL in ../lib/web3auth.ts) to finish login. expo-web-browser's auth
 * session catches that redirect and resolves the login. But on some devices —
 * notably real Chrome Custom Tabs on Android — the custom-scheme redirect is ALSO
 * delivered to the app as a deep-link intent, which expo-router resolves as a
 * navigation to `/auth`. With no matching route the user briefly lands on the
 * "+not-found" screen ("Page could not be found. horizonmarket://auth/") even
 * though login itself succeeds. (The emulator's browser doesn't emit that stray
 * intent, so it only reproduces on-device.)
 *
 * This route absorbs the stray navigation and bounces straight back to the app —
 * home, not literally `/`: on iOS the Buy tab isn't registered, so a redirect to
 * `/` would go nowhere and leave this blank route on screen.
 */
export default function AuthRedirect() {
  return <Redirect href={HOME_PATH} />;
}
