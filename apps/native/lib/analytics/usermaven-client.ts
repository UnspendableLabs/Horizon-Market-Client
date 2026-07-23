/**
 * Minimal Usermaven transport for React Native, reimplementing the wire
 * protocol of `@usermaven/sdk-js` by hand (that package is DOM-oriented —
 * cookies, `window`, `navigator` — and doesn't run in RN).
 *
 * v1 tracks anonymously only: the web app's `analytics_id` is a server-side
 * salted hash of the wallet address (secret salt + a Postgres lookup on the
 * Horizon Market backend), not reproducible from this app. Instead each
 * device gets a random id, generated once and persisted so it stays stable
 * across launches. Merging mobile sessions into a wallet's web identity is a
 * deliberate follow-up, not done here.
 *
 * Uses only the PUBLIC Usermaven key (confirmed against the SDK's bundled
 * source: it never sends a second/server credential — the same key goes in
 * both `?token=` and the body's `api_key`).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID, getRandomBytes } from "expo-crypto";

const TRACKING_HOST = "https://events.usermaven.com";
const API_KEY = process.env.EXPO_PUBLIC_USERMAVEN_API_KEY ?? "";

const ANONYMOUS_ID_KEY = "horizon.analytics.anonymousId";
const CONSENT_KEY = "horizon.analytics.consent";

let anonymousIdPromise: Promise<string> | null = null;

async function getAnonymousId(): Promise<string> {
  if (!anonymousIdPromise) {
    anonymousIdPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(ANONYMOUS_ID_KEY);
        if (stored) return stored;
        const fresh = randomUUID();
        await AsyncStorage.setItem(ANONYMOUS_ID_KEY, fresh);
        return fresh;
      } catch {
        // Storage unavailable — fall back to a per-session id rather than
        // failing tracking outright.
        return randomUUID();
      }
    })();
  }
  return anonymousIdPromise;
}

// Cached after the first read so the frequent per-event consent check (every
// track() call, including every screen-view) doesn't hit AsyncStorage each
// time. `null` means "not loaded yet", distinct from a stored `false`.
let consentCache: boolean | null = null;

/** Whether the user has opted out of analytics (default: opted in). */
export async function hasAnalyticsConsent(): Promise<boolean> {
  if (consentCache !== null) return consentCache;
  try {
    const stored = await AsyncStorage.getItem(CONSENT_KEY);
    consentCache = stored !== "false";
    return consentCache;
  } catch {
    return true;
  }
}

export async function setAnalyticsConsent(consent: boolean): Promise<void> {
  consentCache = consent;
  try {
    await AsyncStorage.setItem(CONSENT_KEY, consent ? "true" : "false");
  } catch {
    // Best-effort — ignore storage failures.
  }
}

/** Opaque per-event id. Hex, not base36 — a `byte % 36` mapping would be
 * subtly biased toward low values (256 isn't a multiple of 36). */
function randomEventId(): string {
  const bytes = getRandomBytes(10);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type EventPayload = Record<string, unknown>;

/**
 * Fire a Usermaven event. No-ops silently when the API key is unset, consent
 * is withheld, or the request fails — analytics must never surface an error
 * or block the UI (same fail-silently posture as the web wrapper).
 */
export async function track(
  eventName: string,
  properties?: EventPayload,
  path?: string,
): Promise<void> {
  if (!API_KEY) return;
  try {
    if (!(await hasAnalyticsConsent())) return;
    const anonymousId = await getAnonymousId();
    const docPath = path ?? "";

    const envelope = {
      event_id: randomEventId(),
      user: { anonymous_id: anonymousId },
      ids: {},
      utc_time: new Date().toISOString(),
      local_tz_offset: new Date().getTimezoneOffset(),
      api_key: API_KEY,
      src: "usermaven",
      event_type: eventName,
      namespace: "default",
      event_attributes: properties ?? {},
      // `docPath` already carries a leading "/" (it's a router pathname) —
      // strip it here so the scheme's "//" doesn't turn into a triple slash.
      url: `horizonmarket://${docPath.replace(/^\/+/, "")}`,
      doc_path: docPath,
      doc_host: "native-app",
      referer: "",
    };

    await fetch(
      `${TRACKING_HOST}/api/v1/event?token=${encodeURIComponent(API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([envelope]),
      },
    );
  } catch {
    // Never let a network failure surface — analytics is best-effort.
  }
}
