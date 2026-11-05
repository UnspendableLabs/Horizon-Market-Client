import { describe, expect, it } from "vitest";
import { HorizonMarketApiError } from "../../api/http.js";
import {
  failureMessage,
  isUserFacingError,
  TEMPORARILY_UNAVAILABLE,
  UserFacingError,
} from "./failureMessage.js";

describe("failureMessage", () => {
  const neutral = (what: string) =>
    `Couldn't ${what} right now. ${TEMPORARILY_UNAVAILABLE}`;

  it("hides a server's 5xx behind the neutral line", () => {
    const err = new HorizonMarketApiError(500, "Internal Server Error");
    expect(isUserFacingError(err)).toBe(false);
    expect(failureMessage(err, "sign in to Horizon Market")).toBe(
      neutral("sign in to Horizon Market"),
    );
  });

  it("hides an upstream indexer's status line", () => {
    for (const msg of [
      "mempool address returned 503",
      "Ord API returned 502: Bad Gateway",
      "Counterparty API returned 429: Too Many Requests",
      "Network request failed",
      "Unexpected token < in JSON at position 0",
    ]) {
      const text = failureMessage(new Error(msg), "load your BTC balance");
      expect(text).toBe(neutral("load your BTC balance"));
      expect(text).not.toContain("5");
    }
  });

  it("keeps a Horizon Market 4xx reason, without the HTTP prefix", () => {
    const err = new HorizonMarketApiError(409, "Username already taken");
    expect(isUserFacingError(err)).toBe(true);
    expect(failureMessage(err, "save your profile")).toBe(
      "Couldn't save your profile: Username already taken",
    );
  });

  it("keeps an error written for the user, through a cause chain", () => {
    const inner = new UserFacingError(
      "Kontor could not start in this environment.",
    );
    const outer = new Error("read failed", { cause: inner });
    expect(isUserFacingError(outer)).toBe(true);
    expect(failureMessage(outer, "load your Kontor holdings")).toBe(
      "Couldn't load your Kontor holdings: read failed — Kontor could not start in this environment.",
    );
  });

  it("treats a 4xx wrapped under a generic error as user-facing", () => {
    const err = new Error("Request failed", {
      cause: new HorizonMarketApiError(401, "Unauthorized"),
    });
    expect(failureMessage(err, "load your profile")).toBe(
      "Couldn't load your profile: Request failed — Unauthorized",
    );
  });

  it("handles non-Error throwables", () => {
    expect(failureMessage("boom", "do it")).toBe(neutral("do it"));
    expect(failureMessage(undefined, "do it")).toBe(neutral("do it"));
  });
});
