/**
 * Blocks screenshots and screen recording for as long as it is mounted, so any
 * screen showing secret material (a recovery phrase) can't be captured by another
 * app / screen-recorder / the OS multitasking snapshot. On Android this sets the
 * window's FLAG_SECURE (blocks screenshots, screen recording, AND the recents
 * thumbnail); on iOS it obscures the content from screen recordings where the OS
 * allows it. Renders nothing.
 *
 * Mount it CONDITIONALLY — only while the secret is actually on screen (e.g. inside
 * a `{revealed && (…)}` block) — so it protects exactly the secret and doesn't block
 * legitimate screenshots of the rest of the app. `usePreventScreenCapture` releases
 * the guard automatically on unmount, and its string key keeps overlapping guards
 * from releasing each other early.
 */
import { usePreventScreenCapture } from "expo-screen-capture";

export function ScreenCaptureGuard({ guardKey }: { guardKey: string }) {
  usePreventScreenCapture(guardKey);
  return null;
}
