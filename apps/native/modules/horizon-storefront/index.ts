/**
 * JS side of the local `HorizonStorefront` Expo module (ios/), which reads the
 * App Store storefront country through StoreKit.
 *
 * iOS only: expo-module.config.json lists "apple" alone, so Android never links
 * it — and an iOS binary built before the module existed doesn't have it either.
 * Both resolve to `null` here, as does every failure, so a caller deciding
 * anything from this is fail-closed by construction. Being native code, a change
 * here needs a native rebuild, not just a Metro reload.
 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

interface HorizonStorefrontNativeModule {
  getCountryCodeAsync(): Promise<string | null>;
}

const native =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<HorizonStorefrontNativeModule>("HorizonStorefront")
    : null;

/**
 * StoreKit asks the App Store for the storefront and can sit on that with no
 * network; past this, the answer is "unknown" rather than a spinner.
 */
const TIMEOUT_MS = 5000;

let pending: Promise<string | null> | null = null;

async function read(module: HorizonStorefrontNativeModule): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    });
    const code = await Promise.race([module.getCountryCodeAsync(), timeout]);
    return typeof code === "string" && /^[A-Za-z]{3}$/.test(code)
      ? code.toUpperCase()
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The storefront's ISO 3166-1 alpha-3 country code ("USA", "FRA", …), or `null`
 * when it isn't known. A known answer is shared by every caller for the rest of
 * the session; an unknown one isn't cached, so the next caller asks again.
 */
export function getStorefrontCountryCode(): Promise<string | null> {
  if (!native) return Promise.resolve(null);
  if (!pending) {
    pending = read(native).then((code) => {
      if (code === null) pending = null;
      return code;
    });
  }
  return pending;
}
