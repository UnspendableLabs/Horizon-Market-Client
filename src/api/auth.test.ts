import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  requestWalletChallenge,
  completeWalletSignIn,
  getSession,
} from "./auth.js";
import { makeFetch, mockResponse, makeFetchResponses } from "../test-utils.js";

describe("requestWalletChallenge", () => {
  it("posts the address and unwraps { nonce, message }", async () => {
    const fetchFn = makeFetch(200, {
      success: true,
      data: { nonce: "9f1c", message: "horizon.market wants you to sign in…" },
    });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    const challenge = await requestWalletChallenge(http, "bc1qseller");

    expect(challenge).toEqual({
      nonce: "9f1c",
      message: "horizon.market wants you to sign in…",
    });
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://example.com/api/auth/wallet/challenges");
    expect(JSON.parse(init.body as string)).toEqual({ address: "bc1qseller" });
  });
});

describe("completeWalletSignIn", () => {
  it("runs csrf → callback and captures the session cookie", async () => {
    const fetchFn = makeFetchResponses(
      mockResponse(200, { csrfToken: "csrf123" }, [
        "authjs.csrf-token=csrftok; Path=/; HttpOnly",
      ]),
      mockResponse(200, { url: "/" }, [
        "authjs.session-token=sess123; Path=/; HttpOnly",
      ]),
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await completeWalletSignIn(http, {
      address: "bc1qseller",
      signature: "base64sig==",
      nonce: "9f1c",
      walletProvider: "horizon-market-client",
      taprootAddress: "bc1pseller",
    });

    expect(http.hasSessionCookie()).toBe(true);

    // First call: GET /api/auth/csrf
    const [csrfUrl, csrfInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(csrfUrl).toBe("https://example.com/api/auth/csrf");
    expect(csrfInit.method).toBe("GET");

    // Second call: POST /api/auth/callback/WALLET with the csrf cookie attached.
    const [cbUrl, cbInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(cbUrl).toBe("https://example.com/api/auth/callback/WALLET");
    expect(cbInit.method).toBe("POST");
    expect((cbInit.headers as Headers).get("Cookie")).toContain(
      "authjs.csrf-token=csrftok",
    );
    const form = new URLSearchParams(cbInit.body as string);
    expect(form.get("csrfToken")).toBe("csrf123");
    expect(form.get("address")).toBe("bc1qseller");
    expect(form.get("signature")).toBe("base64sig==");
    expect(form.get("nonce")).toBe("9f1c");
    expect(form.get("wallet_provider")).toBe("horizon-market-client");
    expect(form.get("taproot_address")).toBe("bc1pseller");
  });

  it("attaches the session cookie to subsequent requests", async () => {
    const fetchFn = makeFetchResponses(
      mockResponse(200, { csrfToken: "csrf123" }, [
        "authjs.csrf-token=csrftok; Path=/",
      ]),
      mockResponse(200, { url: "/" }, ["authjs.session-token=sess123; Path=/"]),
      mockResponse(200, { data: { ok: true } }),
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await completeWalletSignIn(http, {
      address: "bc1qseller",
      signature: "sig",
      nonce: "9f1c",
      walletProvider: "horizon-market-client",
    });
    await http.request("GET", "/api/atomic-swaps");

    const [, init] = fetchFn.mock.calls[2] as [string, RequestInit];
    const cookie = (init.headers as Record<string, string>)["Cookie"];
    expect(cookie).toContain("authjs.session-token=sess123");
  });

  it("throws when no session is established", async () => {
    const fetchFn = makeFetchResponses(
      mockResponse(200, { csrfToken: "csrf123" }, [
        "authjs.csrf-token=csrftok; Path=/",
      ]),
      // Failed sign-in: redirect to error page, no session cookie set.
      mockResponse(200, { url: "/api/auth/error?error=CredentialsSignin" }),
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await expect(
      completeWalletSignIn(http, {
        address: "bc1qseller",
        signature: "badsig",
        nonce: "9f1c",
        walletProvider: "horizon-market-client",
      }),
    ).rejects.toBeInstanceOf(HorizonMarketApiError);
    expect(http.hasSessionCookie()).toBe(false);
  });

  it("throws when the CSRF token is missing", async () => {
    const fetchFn = makeFetchResponses(mockResponse(200, {}));
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });

    await expect(
      completeWalletSignIn(http, {
        address: "bc1qseller",
        signature: "sig",
        nonce: "9f1c",
        walletProvider: "horizon-market-client",
      }),
    ).rejects.toThrow(/CSRF/);
  });
});

describe("getSession", () => {
  it("returns user info when authenticated", async () => {
    const fetchFn = makeFetchResponses(
      mockResponse(200, {
        user: { id: "user_1", address: "bc1qseller", email: null },
      }),
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    const session = await getSession(http);
    expect(session).toEqual({ id: "user_1", address: "bc1qseller", email: null });
  });

  it("returns null on an empty session", async () => {
    const fetchFn = makeFetchResponses(mockResponse(200, {}));
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    expect(await getSession(http)).toBeNull();
  });
});
