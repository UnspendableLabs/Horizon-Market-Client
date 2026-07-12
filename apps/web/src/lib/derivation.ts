/**
 * Persistence for the address-derivation choice, mirroring src/lib/networks.ts.
 * Read synchronously from localStorage so the first render already has the right
 * value (no flash / re-derive):
 *   - "horizon-market" (default) → raw single-key, same addresses as
 *     horizon.market.
 *   - "horizon-wallet" → BIP39 / Horizon-Wallet convention (BIP84 + BIP86). The
 *     phrase is always 12 words (the SDK default) — the only length Horizon
 *     Wallet imports, and XVerse-compatible too — so there's no word-count choice.
 */
import type { DerivationMode } from "@unspendablelabs/horizon-market-client/react";

const MODE_KEY = "horizon.derivationMode";

function isMode(v: string | null): v is DerivationMode {
  return v === "horizon-market" || v === "horizon-wallet";
}

/** Initial derivation mode: persisted choice (localStorage) → "horizon-market". */
export function getInitialDerivationMode(): DerivationMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }
  return "horizon-market";
}

/** Persist the derivation mode so it survives a reload. */
export function persistDerivationMode(mode: DerivationMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Best-effort — ignore storage failures.
  }
}
