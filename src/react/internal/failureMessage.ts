import { HorizonMarketApiError } from "../../api/http.js";

/**
 * An error whose message was written for the person using the app rather than
 * for a developer. The default renderers show it verbatim; every other failure
 * is reduced to {@link failureMessage}'s neutral wording.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UserFacingError";
  }
}

/** The one line a user gets for a failure that is the service's, not theirs. */
export const TEMPORARILY_UNAVAILABLE =
  "The service may be temporarily unavailable. Please try again in a moment.";

/**
 * Whether `err` carries a reason the user can act on: a Horizon Market 4xx
 * (bad input, not signed in, a taken username, a rate limit) or an error marked
 * {@link UserFacingError} anywhere in its `cause` chain. A 5xx, a failed or
 * timed-out fetch, an upstream indexer's status line, a JSON parse error — none
 * of those tell the user anything they can do, so they are not.
 */
export function isUserFacingError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof UserFacingError || cur.name === "UserFacingError") {
      return true;
    }
    if (cur instanceof HorizonMarketApiError) {
      return cur.status >= 400 && cur.status < 500;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The reason to show for a user-facing error: the server's own `error` text for
 * an API error (not its `HTTP 409:` prefix), else the message chain.
 */
function userFacingText(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    const text = cur instanceof HorizonMarketApiError ? cur.error : cur.message;
    if (text && !parts.includes(text)) parts.push(text);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.length ? parts.join(" — ") : "Unknown error";
}

/**
 * What to tell the user when `what` failed — `failureMessage(err, "load your
 * BTC balance")`.
 *
 * A reason the user can act on ({@link isUserFacingError}) is kept:
 * `Couldn't save your profile: Username already taken`. Everything else — a
 * 5xx, a dead indexer, a dropped connection — becomes
 * `Couldn't load your BTC balance right now.` plus
 * {@link TEMPORARILY_UNAVAILABLE}, with no status code or upstream text. The
 * technical error stays on the object for logging; it never reaches the screen.
 * (App Review once read a raw "server error" off a balance line and rejected
 * the build for it; the user could do nothing with that text either.)
 */
export function failureMessage(err: unknown, what: string): string {
  if (isUserFacingError(err)) {
    return `Couldn't ${what}: ${userFacingText(err)}`;
  }
  return `Couldn't ${what} right now. ${TEMPORARILY_UNAVAILABLE}`;
}
