/**
 * Persistence for the address-derivation choice, mirroring lib/networks.ts
 * (AsyncStorage, async):
 *   - "horizon-market" (default) → raw single-key, same addresses as
 *     horizon.market.
 *   - "horizon-wallet" → BIP39 / Horizon-Wallet convention (BIP84 + BIP86),
 *     exportable to the Horizon Wallet extension / XVerse. The phrase is always
 *     12 words (the SDK default) — the only length Horizon Wallet imports, and
 *     XVerse-compatible too — so there's no word-count choice to persist.
 *
 * AsyncStorage can't be read synchronously, so `getInitialDerivationMode` returns
 * the default and the persisted choice is loaded via `loadPersistedDerivationMode`
 * and applied on mount (the provider is controlled, so a later value re-derives).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DerivationMode } from "@unspendablelabs/horizon-market-client/react";

const MODE_KEY = "horizon.derivationMode";

function isMode(v: string | null): v is DerivationMode {
  return v === "horizon-market" || v === "horizon-wallet";
}

/** Synchronous initial mode (default). Persisted value arrives via {@link loadPersistedDerivationMode}. */
export function getInitialDerivationMode(): DerivationMode {
  return "horizon-market";
}

/** Read the persisted mode, or null if none / unavailable. */
export async function loadPersistedDerivationMode(): Promise<DerivationMode | null> {
  try {
    const stored = await AsyncStorage.getItem(MODE_KEY);
    return isMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Persist the mode so it survives an app relaunch. */
export async function persistDerivationMode(mode: DerivationMode): Promise<void> {
  try {
    await AsyncStorage.setItem(MODE_KEY, mode);
  } catch {
    // Best-effort — ignore storage failures.
  }
}
