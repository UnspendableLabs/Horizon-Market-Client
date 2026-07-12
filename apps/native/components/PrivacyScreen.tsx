/**
 * Privacy screen — an opaque brand cover shown whenever the app is not in the
 * foreground, so the OS app-switcher / multitasking snapshot doesn't leak wallet
 * balances or addresses. It's the SAME <BrandCover/> as the app-lock boot cover and
 * lock overlay (just the H mark), so leaving/returning to the app is visually
 * seamless with the splash — no separate wordmark screen to jump to.
 *
 * The snapshot is captured as the app leaves the foreground, so we cover on any
 * non-"active" AppState ("inactive" and "background"). Rendering on "inactive"
 * (which fires just before "background") gives React a head start to commit the
 * cover before iOS grabs the thumbnail. This is the JS-only approach; on Android
 * a native FLAG_SECURE (expo-screen-capture) would be more airtight but would
 * also block all screenshots, which isn't what we want here.
 *
 * Note: the biometric sheet also drives AppState to "inactive", so this cover
 * shows briefly behind the system prompt — harmless (it's the same brand screen).
 */
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { BrandCover } from "./BrandCover.js";

export function PrivacyScreen() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setHidden(next !== "active");
    });
    return () => sub.remove();
  }, []);

  if (!hidden) return null;

  return <BrandCover pointerEvents="none" />;
}
