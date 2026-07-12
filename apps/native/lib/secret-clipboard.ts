/**
 * Copy-secret-to-clipboard with an automatic wipe.
 *
 * The clipboard is a SHARED surface: other apps can read it (silently on older
 * Android), and iOS Universal Clipboard syncs it to the user's other devices. So a
 * recovery phrase must not linger there. `useSecretClipboard` copies the secret and
 * schedules a wipe ~a minute later — but only if the clipboard STILL holds exactly
 * what we put there, so we never clobber something the user copied in the meantime.
 *
 * The wipe DELIBERATELY outlives the component: it must still fire if the user copies
 * the phrase and then leaves the screen (the common case — copy, go paste it into a
 * password manager). The scheduled callback touches only the clipboard, never React
 * state, so a pending timer after unmount is safe (no setState-after-unmount), and a
 * fresh copy cancels the previous timer so they never stack while mounted.
 */
import { useCallback, useRef } from "react";
import * as Clipboard from "expo-clipboard";

/** How long a copied secret is allowed to sit in the clipboard before auto-wipe. */
const CLEAR_AFTER_MS = 60_000;

export function useSecretClipboard(): (secret: string) => Promise<void> {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(async (secret: string) => {
    await Clipboard.setStringAsync(secret);
    // Supersede any earlier pending wipe so re-copying restarts the full window.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        try {
          // Only wipe if the clipboard still holds OUR secret — otherwise the user
          // has copied something else since and we'd be clobbering it.
          if ((await Clipboard.getStringAsync()) === secret) {
            await Clipboard.setStringAsync("");
          }
        } catch {
          /* best-effort — a clipboard failure just means it isn't auto-cleared */
        }
      })();
    }, CLEAR_AFTER_MS);
  }, []);
}
