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
 * GRACEFUL DEGRADATION (fail-closed): `requireAuthentication` needs an enrolled
 * authenticator (biometric or device credential). We decide up front with the SAME
 * gate the app-lock uses (`canUseAppLock`): only when NOTHING is enrolled
 * (emulators, a phone with no lock) do we fall back to storing the secret
 * device-bound but WITHOUT the auth gate — still hardware-encrypted and excluded
 * from backups, just without the extra prompt the device can't present anyway.
 * When an authenticator IS enrolled we attempt only the gated write and NEVER
 * downgrade: a cancelled prompt or transient error leaves no secret stored (the
 * caller just re-restores), so we never silently strip the gate off a raw key.
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
import { canUseAppLock } from "./app-lock.js";

const PRIVATE_KEY_KEY = "horizon.wallet.privateKey";
// Non-secret marker read by hasStoredKey(): "a wallet key exists". Stored WITHOUT
// requireAuthentication so presence checks never trigger the biometric prompt. Its
// VALUE also records whether the key is sealed behind the OS auth gate, so the
// restore path can tell whether reading the key actually prompts (see below).
const PRESENCE_KEY = "horizon.wallet.hasKey";

// The mnemonic slot: a BIP39 recovery phrase from a Restore / New HD wallet flow.
// Same gated-at-rest posture and presence-marker scheme as the raw key above — it
// just holds words instead of a hex key. A given session persists EITHER a key
// (web3auth) or a mnemonic, never both.
const MNEMONIC_KEY = "horizon.wallet.mnemonic";
const MNEMONIC_PRESENCE_KEY = "horizon.wallet.hasMnemonic";
// Marker values. "gated" → the key was written auth-gated, so reading it triggers a
// biometric/device-credential prompt (that read IS the app-lock's OS auth). "plain"
// → written un-gated (device couldn't satisfy requireAuthentication, e.g. an
// emulator with no enrolled authenticator), so its read is SILENT and must NOT be
// mistaken for an OS auth.
const MARKER_GATED = "gated";
const MARKER_PLAIN = "plain";

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

// ── Shared secret slot implementation ───────────────────────────────────────
// The raw key and the mnemonic are stored the same way — auth-gated at rest with
// a non-auth presence marker — so both slots share these helpers, parameterized
// by their secret + marker keys and a human label used only in fallback logs.

/**
 * Reads a secret — triggers the OS auth prompt when the entry is gated. Returns
 * null on cancel, error, or an entry invalidated by a biometric-enrollment change;
 * callers treat all of those as "no cache" and fall back to a fresh restore.
 */
async function readSecret(secretKey: string): Promise<string | null> {
  // Try the auth-gated entry first (the strong path, triggers the OS prompt),
  // then the non-gated fallback used on devices without an enrolled authenticator.
  // A cancel / enrollment-change on a real auth-gated entry makes BOTH fail → null.
  try {
    return await SecureStore.getItemAsync(secretKey, AUTH_OPTS);
  } catch {
    try {
      return await SecureStore.getItemAsync(secretKey, NON_AUTH_KEY_OPTS);
    } catch {
      return null;
    }
  }
}

async function writeSecret(
  secretKey: string,
  presenceKey: string,
  value: string,
  label: string,
): Promise<void> {
  try {
    // Delete any prior entry first so the value is always bound to a FRESHLY
    // written secret — requireAuthentication won't cleanly update a pre-existing
    // entry, and this also wipes any stale value left by an older build. No auth.
    try {
      await SecureStore.deleteItemAsync(secretKey);
    } catch {
      /* nothing to delete */
    }
    // Decide gated-vs-not up front from actual enrollment, NOT by catching the
    // gated write's error. This is what makes the fallback fail-closed: on a device
    // that CAN authenticate, a thrown gated write (a cancelled prompt — Android
    // prompts on write too — or a transient error) propagates to the outer catch
    // and stores nothing, instead of silently re-writing the raw key un-gated.
    let gated = false;
    if (await canUseAppLock()) {
      // Strong path: sealed behind the OS auth gate.
      await SecureStore.setItemAsync(secretKey, value, AUTH_OPTS);
      gated = true;
    } else {
      // No biometric/credential enrolled (common on emulators). Degrade to
      // device-bound-only storage so the wallet still persists across cold starts.
      // Not console.error: this is an expected degradation, not a failure — an
      // .error would pop the dev LogBox overlay on top of the app.
      console.warn(
        `Auth-gated keystore unavailable (no biometrics/credential enrolled); ` +
          `storing the ${label} device-bound only.`,
      );
      await SecureStore.setItemAsync(secretKey, value, NON_AUTH_KEY_OPTS);
    }
    // Mark presence only AFTER a write actually succeeds, so a device that can
    // store nothing never advertises a secret it can't read back. The value records
    // whether the secret is auth-gated, so the restore path knows if reading it will
    // prompt (and thus doubles as the app-lock's OS auth) or read silently.
    await SecureStore.setItemAsync(
      presenceKey,
      gated ? MARKER_GATED : MARKER_PLAIN,
      MARKER_OPTS,
    );
  } catch (err) {
    console.error(`Failed to persist wallet ${label} to keystore:`, err);
  }
}

async function clearSecret(
  secretKey: string,
  presenceKey: string,
): Promise<void> {
  // Delete both entries; deletion never requires auth (so logout never prompts).
  try {
    await SecureStore.deleteItemAsync(secretKey);
  } catch {
    /* ignore — non-fatal */
  }
  try {
    await SecureStore.deleteItemAsync(presenceKey);
  } catch {
    /* ignore — non-fatal */
  }
}

/** Presence check via the non-auth marker → never prompts. */
async function hasSecret(presenceKey: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(presenceKey, MARKER_OPTS)) != null;
  } catch {
    return false;
  }
}

/**
 * True only when the stored secret is sealed behind the OS auth gate — i.e. reading
 * it triggers a biometric / device-credential prompt. On devices that couldn't
 * satisfy requireAuthentication (emulators, no enrolled authenticator) the secret is
 * stored un-gated, so its read is SILENT and must NOT be mistaken for an OS auth.
 * Anything but the explicit "gated" marker (including a legacy marker written before
 * this distinction existed) is treated as un-gated, so the app-lock FAILS CLOSED and
 * presents its own prompt rather than skipping the lock on a silent read.
 */
async function isSecretGated(presenceKey: string): Promise<boolean> {
  try {
    return (
      (await SecureStore.getItemAsync(presenceKey, MARKER_OPTS)) === MARKER_GATED
    );
  } catch {
    return false;
  }
}

// ── Raw private key (web3auth) ───────────────────────────────────────────────

/**
 * Reads the raw key — triggers the OS auth prompt. Returns null on cancel, error,
 * or a key invalidated by a biometric-enrollment change; callers fall back to a
 * Web3Auth restore in every one of those cases.
 */
export function getStoredKey(): Promise<string | null> {
  return readSecret(PRIVATE_KEY_KEY);
}

export function setStoredKey(key: string): Promise<void> {
  return writeSecret(PRIVATE_KEY_KEY, PRESENCE_KEY, key, "key");
}

export function clearStoredKey(): Promise<void> {
  return clearSecret(PRIVATE_KEY_KEY, PRESENCE_KEY);
}

export function hasStoredKey(): Promise<boolean> {
  return hasSecret(PRESENCE_KEY);
}

export function isStoredKeyGated(): Promise<boolean> {
  return isSecretGated(PRESENCE_KEY);
}

// ── BIP39 mnemonic (Restore / New HD wallet) ─────────────────────────────────

/**
 * Reads the stored recovery phrase — triggers the OS auth prompt when gated.
 * Returns null on cancel / error / enrollment change (callers treat as "no cache").
 */
export function getStoredMnemonic(): Promise<string | null> {
  return readSecret(MNEMONIC_KEY);
}

export function setStoredMnemonic(mnemonic: string): Promise<void> {
  return writeSecret(MNEMONIC_KEY, MNEMONIC_PRESENCE_KEY, mnemonic, "mnemonic");
}

export function clearStoredMnemonic(): Promise<void> {
  return clearSecret(MNEMONIC_KEY, MNEMONIC_PRESENCE_KEY);
}

export function hasStoredMnemonic(): Promise<boolean> {
  return hasSecret(MNEMONIC_PRESENCE_KEY);
}

export function isStoredMnemonicGated(): Promise<boolean> {
  return isSecretGated(MNEMONIC_PRESENCE_KEY);
}
