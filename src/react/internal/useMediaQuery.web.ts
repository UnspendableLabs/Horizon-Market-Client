import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * Used by the web components to switch between the desktop layout and a compact
 * phone layout (inline styles can't carry `@media` rules, so the breakpoint has
 * to be observed in JS). SSR-safe: returns `false` until mounted, then syncs to
 * the real value on the first effect.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Shared phone breakpoint — below this the web UI switches to the stacked,
 * touch-friendly layout that mirrors the native app. */
export const PHONE_QUERY = "(max-width: 640px)";

/** Convenience wrapper around {@link useMediaQuery} for the phone breakpoint. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
