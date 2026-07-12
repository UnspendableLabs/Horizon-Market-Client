/**
 * Native app-lock via the OS authentication sheet (expo-local-authentication).
 *
 * This is the biometric / device-passcode gate that protects the app once a
 * wallet session exists — the same pattern banking apps (Kraken, etc.) use:
 * Face ID / Touch ID / fingerprint first, with the phone's own passcode/PIN/
 * pattern as the fallback when biometrics fail or aren't enrolled.
 *
 * Everything runs against the OS — we never see or store a secret here; the
 * platform reports success/failure and we simply gate the UI on it.
 */
import * as LocalAuthentication from "expo-local-authentication";

/**
 * True when the device can actually gate the app — either biometrics are
 * enrolled (Face ID / Touch ID / fingerprint) OR a device passcode/PIN/pattern
 * is set (SecurityLevel.SECRET), which we fall back to. If the device has no
 * secure lock configured at all there's nothing to authenticate against, so the
 * caller skips the lock rather than trapping the user out of their own app.
 */
export async function canUseAppLock(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/**
 * Presents the OS authentication sheet and resolves true only on success.
 *
 * `disableDeviceFallback: false` is the key to the "échappatoire" the user asked
 * for: on iOS, after biometrics fail the system offers "Enter Passcode"; on
 * Android the prompt allows the device credential (PIN/pattern/password). It also
 * means a device with only a passcode (no biometric hardware) can still unlock.
 *
 * We deliberately omit `cancelLabel`: when the device-credential fallback is
 * enabled, Android's BiometricPrompt cannot also carry a negative button, and
 * passing one there is a runtime error — so we let the OS render its default.
 */
export async function authenticate(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Horizon Market",
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}
