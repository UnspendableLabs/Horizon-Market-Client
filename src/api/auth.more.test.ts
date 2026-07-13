import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  completeWalletSignIn,
  walletSignInToken,
  getCredits,
  getSession,
} from "./auth.js";
import { makeFetch, mockResponse, makeFetchResponses } from "../test-utils.js";

// These top-up tests target the branches auth.test.ts leaves uncovered:
// the non-JSON callback body path, the token sign-in endpoint, getCredits, and
// getSession's non-auth error status.

describe("completeWalletSignIn (non-JSON callback body)", () => {
  it("throws with the HTTP status when the callback response is not JSON and no session is set", async () => {
    // csrf ok (sets only the csrf cookie), then a 5xx callback whose body is not
    // JSON → the `catch {}` around callbackRes.json() runs and `detail` stays the
    // raw HTTP status; the thrown status uses the >= 400 branch (not the 401 fallback).
    const badCallback = {
      status: 502,
      ok: false,
      statusText: "Bad Gateway",
      headers: new Headers(),
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response;

    const fetchFn = makeFetchResponses(
      mockResponse(200, { csrfToken: "csrf123" }, [
        "authjs.csrf-token=csrftok; Path=/",
      ]),
      badCallback,
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await expect(
      completeWalletSignIn(http, {
        address: "bc1qseller",
        signature: "sig",
        nonce: "9f1c",
        walletProvider: "horizon-market-client",
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(http.hasSessionCookie()).toBe(false);
  });
});

describe("walletSignInToken", () => {
  it("posts the token sign-in with taproot address and unwraps the balance", async () => {
    const fetchFn = makeFetch(200, {
      data: { token: "jwt.abc", credits: 4, free_credits: 6 },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    const result = await walletSignInToken(http, {
      address: "bc1qseller",
      signature: "sig",
      nonce: "9f1c",
      walletProvider: "horizon-market-client",
      taprootAddress: "bc1pseller",
    });

    expect(result).toEqual({ token: "jwt.abc", credits: 4, freeCredits: 6 });

    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://example.com/api/auth/wallet/token");
    const body = JSON.parse(init.body as string);
    expect(body.address).toBe("bc1qseller");
    expect(body.wallet_provider).toBe("horizon-market-client");
    expect(body.taproot_address).toBe("bc1pseller");
  });

  it("omits taproot_address when it is not provided", async () => {
    const fetchFn = makeFetch(200, {
      data: { token: "jwt", credits: 0, free_credits: 0 },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await walletSignInToken(http, {
      address: "bc1qseller",
      signature: "sig",
      nonce: "9f1c",
      walletProvider: "hmc",
    });

    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect("taproot_address" in body).toBe(false);
  });
});

describe("getCredits", () => {
  it("returns null on an auth-shaped status (403)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(403, {}),
    });
    expect(await getCredits(http)).toBeNull();
  });

  it("throws on a transient 5xx (does not treat it as signed-out)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(503, {}),
    });
    await expect(getCredits(http)).rejects.toBeInstanceOf(HorizonMarketApiError);
  });

  it("returns null when the body carries no data envelope", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, {}),
    });
    expect(await getCredits(http)).toBeNull();
  });

  it("maps credits and free_credits from the data envelope", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: { credits: 5, free_credits: 3 } }),
    });
    expect(await getCredits(http)).toEqual({ credits: 5, freeCredits: 3 });
  });

  it("defaults missing credit fields to 0", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: {} }),
    });
    expect(await getCredits(http)).toEqual({ credits: 0, freeCredits: 0 });
  });
});

describe("getSession (error status)", () => {
  it("throws on a non-auth error status (500)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(500, {}),
    });
    await expect(getSession(http)).rejects.toBeInstanceOf(HorizonMarketApiError);
  });

  it("returns null on an auth-shaped status (401)", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(401, {}),
    });
    expect(await getSession(http)).toBeNull();
  });
});
