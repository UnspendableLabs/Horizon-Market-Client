/**
 * Raw private-key cache in the device OS keychain (expo-secure-store).
 *
 * Why this exists: Web3Auth stores only an encrypted *session id*, so every cold
 * start had to lazy-load the heavy @web3auth/react-native-sdk graph AND do a
 * network round-trip to decrypt the session before it could hand back the raw
 * secp256k1 key — the 3–4 s the user sees before the app-lock cover clears. We
 * instead cache the raw key ourselves once we have it, so later cold starts
 * re-derive addresses instantly and Web3Auth is only needed for the first login.
 *
 * ── Security posture (auth-gated at rest, when the device can) ───────────────
 * The key is written with `requireAuthentication` AND WHEN_UNLOCKED_THIS_DEVICE_ONLY:
 *   - hardware-encrypted at rest (iOS Secure Enclave / Android StrongBox-backed
 *     Keystore), device-bound, never synced to iCloud or included in backups;
 *   - sealed behind the OS user-authentication gate: the raw key CANNOT be
 *     unsealed without a fresh biometric / device-credential auth — not by another
 *     app (each app is sandboxed to its own keychain/keystore anyway), and not even
 *     by this app's own code without the user passing the OS prompt. On iOS this is
 *     `biometryCurrentSet`; on Android `setUserAuthenticationRequired(true)`.
 * This raises the bar past sandboxing alone: a rooted/jailbroken device or a
 * forensic extraction cannot read the key without the user's biometric.
 *
 * GRACEFUL DEGRADATION: `requireAuthentication` needs an enrolled authenticator
 * (biometric or device credential). On a device/emulator with NONE enrolled the
 * auth-gated write is *rejected* ("No biometrics are currently enrolled"), so we
 * fall back to storing the key device-bound but WITHOUT the auth gate — still
 * hardware-encrypted and excluded from backups, just without the extra prompt the
 * device can't present anyway. This mirrors the app-lock, which also skips its
 * gate when the device has no secure lock (see lib/app-lock.ts `canUseAppLock`).
 * The read path tries the auth-gated entry first, then the non-gated one, so it
 * recovers the key whichever way it was written.
 *
 * Platform quirks we design around:
 *   - Android prompts on BOTH read and write; iOS prompts only on read/update of an
 *     existing value (not on first create). So a login's key *write* prompts on
 *     Android; a cold-start *read* prompts on both.
 *   - A biometric-enrollment change (new fingerprint / re-scanned face) INVALIDATES
 *     the key: the read then resolves to `null`. Callers treat that as "no cache"
 *     and fall back to a Web3Auth restore, which re-seeds a fresh key — self-healing.
 *   - Reading the key triggers a prompt, so a plain presence check must NOT read it.
 *     A separate, non-auth `PRESENCE_KEY` marker (carries no secret — only the fact
 *     that a key exists) lets the boot cover / session probe learn a wallet is
 *     present without a spurious prompt.
 *
 * Every op is wrapped in try/catch: reads degrade to null, writes/deletes are
 * non-fatal (worst case: a slow restore, never a crash).
 */
import * as SecureStore from "expo-secure-store";

const PRIVATE_KEY_KEY = "horizon.wallet.privateKey";
// Non-secret marker read by hasStoredKey(): "a wallet key exists". Stored WITHOUT
// requireAuthentication so presence checks never trigger the biometric prompt.
const PRESENCE_KEY = "horizon.wallet.hasKey";

// The secret: auth-gated + device-bound. keychainAccessible is iOS-only; Android
// hardware-encrypts regardless. authenticationPrompt labels the OS sheet on read.
const AUTH_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: "Unlock Horizon Market",
};

// The presence marker: device-bound but deliberately NOT auth-gated.
const MARKER_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// Fallback for the KEY on devices that can't satisfy requireAuthentication (no
// biometric/credential enrolled — e.g. emulators): device-bound + hardware-
// encrypted, just without the auth gate the device can't provide. Same shape as
// MARKER_OPTS but named apart to document intent at the key-write call site.
const NON_AUTH_KEY_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * Reads the raw key — triggers the OS auth prompt. Returns null on cancel, error,
 * or a key invalidated by a biometric-enrollment change; callers fall back to a
 * Web3Auth restore in every one of those cases.
 */
export async function getStoredKey(): Promise<string | null> {
  // Try the auth-gated entry first (the strong path, triggers the OS prompt),
  // then the non-gated fallback used on devices without an enrolled authenticator.
  // A cancel / enrollment-change on a real auth-gated key makes BOTH fail → null,
  // and callers fall back to a Web3Auth restore.
  try {
    return await SecureStore.getItemAsync(PRIVATE_KEY_KEY, AUTH_OPTS);
  } catch {
    try {
      return await SecureStore.getItemAsync(PRIVATE_KEY_KEY, NON_AUTH_KEY_OPTS);
    } catch {
      return null;
    }
  }
}

export async function setStoredKey(key: string): Promise<void> {
  try {
    // Delete any prior entry first so the value is always bound to a FRESHLY
    // generated key — requireAuthentication won't cleanly update a pre-existing
    // entry, and this also wipes any stale key left by an older build. No auth needed.
    try {
      await SecureStore.deleteItemAsync(PRIVATE_KEY_KEY);
    } catch {
      /* nothing to delete */
    }
    try {
      // Strong path: sealed behind the OS auth gate.
      await SecureStore.setItemAsync(PRIVATE_KEY_KEY, key, AUTH_OPTS);
    } catch (authErr) {
      // The device can't satisfy requireAuthentication (no biometric/credential
      // enrolled — common on emulators). Degrade to device-bound-only storage so
      // the wallet still persists across cold starts. Not console.error: this is
      // an expected fallback, not a failure — an .error would pop the dev LogBox
      // overlay on top of the app.
      console.warn(
        "Auth-gated keystore unavailable (no biometrics/credential enrolled); " +
          "storing the wallet key device-bound only.",
        authErr,
      );
      await SecureStore.setItemAsync(PRIVATE_KEY_KEY, key, NON_AUTH_KEY_OPTS);
    }
    // Mark presence only AFTER a write actually succeeds, so a device that can
    // store nothing never advertises a key it can't read back.
    await SecureStore.setItemAsync(PRESENCE_KEY, "1", MARKER_OPTS);
  } catch (err) {
    console.error("Failed to persist wallet key to keystore:", err);
  }
}

export async function clearStoredKey(): Promise<void> {
  // Delete both entries; deletion never requires auth (so logout never prompts).
  try {
    await SecureStore.deleteItemAsync(PRIVATE_KEY_KEY);
  } catch {
    /* ignore — non-fatal */
  }
  try {
    await SecureStore.deleteItemAsync(PRESENCE_KEY);
  } catch {
    /* ignore — non-fatal */
  }
}

/** Presence check via the non-auth marker → never prompts. */
export async function hasStoredKey(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PRESENCE_KEY, MARKER_OPTS)) != null;
  } catch {
    return false;
  }
}
