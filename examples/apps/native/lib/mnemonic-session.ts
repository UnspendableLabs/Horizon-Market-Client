/**
 * Recovery-phrase session layer — the mnemonic analogue of lib/web3auth.ts, minus
 * Web3Auth. Owns the lifecycle of a wallet connected from a BIP39 phrase (Restore
 * wallet / New HD wallet): persist it at connect time, restore it at cold start,
 * clear it on disconnect.
 *
 * The phrase itself is sealed in the OS keychain (auth-gated when the device can —
 * see secure-key-store.ts). A session persists EITHER a raw key (web3auth) or a
 * mnemonic, never both, so restore tries the mnemonic first (see _layout's
 * SessionRestorer) and only falls through to the Web3Auth key path when there is
 * no stored phrase.
 */
import { markFreshLogin } from "./app-lock-events.js";
import {
  getStoredMnemonic,
  setStoredMnemonic,
  clearStoredMnemonic,
  hasStoredMnemonic,
  isStoredMnemonicGated,
} from "./secure-key-store.js";

/**
 * In-memory copy of the phrase for THIS app process. Set when we connect or restore
 * a mnemonic session and reused on later probes — crucially across the
 * HorizonMarketProvider's network-switch remount, so switching networks never
 * re-triggers the biometric prompt. Cleared on disconnect; lost on process death,
 * so a genuine cold start re-reads from the keychain (and re-prompts if gated).
 */
let sessionMnemonic: string | null = null;

/**
 * Persist a freshly connected phrase: keep it in memory for the rest of this
 * session and seal it in the keychain so a later cold start restores it instantly.
 * The single persistence choke point for the Restore / New HD wallet flows.
 */
export async function persistMnemonicSession(mnemonic: string): Promise<void> {
  sessionMnemonic = mnemonic;
  await setStoredMnemonic(mnemonic);
}

/**
 * Cold-start restore probe. Returns the phrase to re-connect with, or null when
 * there is no mnemonic session to restore (none cached, or the auth prompt was
 * declined / invalidated — in which case the caller falls through to the key path).
 *
 * Mirrors getPrivateKey("")'s app-lock handling: when the stored phrase is
 * auth-gated, reading it triggers the OS prompt, and passing that IS the app-lock's
 * unlock for this cold start (markFreshLogin), so the lock never prompts twice. An
 * un-gated read (emulator / no enrolled authenticator) is silent and must NOT mark
 * a fresh login, so the app-lock still presents its own prompt.
 */
export async function restoreMnemonicSession(): Promise<string | null> {
  // Already unsealed this session (e.g. a network-switch remount re-probing) →
  // reuse it with no keystore read, so switching networks never re-prompts.
  if (sessionMnemonic) return sessionMnemonic;
  if (!(await hasStoredMnemonic())) return null;
  const stored = await getStoredMnemonic();
  if (!stored) return null; // cancelled or invalidated → caller tries the key path
  sessionMnemonic = stored;
  if (await isStoredMnemonicGated()) markFreshLogin();
  return stored;
}

/** Clear the phrase everywhere: in-memory + keychain. Called on Disconnect. */
export async function clearMnemonicSession(): Promise<void> {
  sessionMnemonic = null;
  await clearStoredMnemonic();
}

/**
 * Cheap (no-prompt, no read) presence check — in-memory copy or the keychain
 * marker. Used by the boot cover so it holds for a restorable mnemonic session.
 */
export async function hasMnemonicSession(): Promise<boolean> {
  if (sessionMnemonic != null) return true;
  return hasStoredMnemonic();
}
