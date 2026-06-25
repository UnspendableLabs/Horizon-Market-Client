import { resolveFetch } from "./resolveFetch.js";

export class HorizonMarketApiError extends Error {
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string) {
    super(`HTTP ${status}: ${error}`);
    this.status = status;
    this.error = error;
    this.name = "HorizonMarketApiError";
  }
}

/**
 * Serialize a value to JSON, converting bigint values to number or string.
 * BigInt values <= Number.MAX_SAFE_INTEGER are converted to number, larger to string.
 */
function serializeBody(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") {
      if (val <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(val);
      }
      return val.toString();
    }
    return val;
  });
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  /** Cookies attached to every request (e.g. the NextAuth session after sign-in). */
  private readonly cookies = new Map<string, string>();

  constructor(options: { baseUrl: string; fetch?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchFn = resolveFetch(options.fetch);
  }

  // ─── Cookie / session handling ──────────────────────────────────────────────

  /** Set or overwrite a stored cookie attached to every subsequent request. */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /**
   * NextAuth/Auth.js session-token cookie name for the configured origin.
   * Auth.js prefixes the cookie with `__Secure-` whenever `useSecureCookies` is
   * on, which is the default for HTTPS origins (i.e. mainnet) — so the server
   * reads `__Secure-authjs.session-token` over HTTPS and `authjs.session-token`
   * over plain HTTP.
   */
  sessionCookieName(): string {
    return this.baseUrl.startsWith("https://")
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";
  }

  /**
   * Store a reused NextAuth session token under the correct cookie name for the
   * configured origin (see {@link sessionCookieName}), so it is recognised by the
   * server even on HTTPS hosts that use the `__Secure-` prefix.
   */
  setSessionToken(token: string): void {
    this.cookies.set(this.sessionCookieName(), token);
  }

  /** Remove all stored cookies (e.g. on sign-out). */
  clearCookies(): void {
    this.cookies.clear();
  }

  /** Serialize the stored cookies into a `Cookie` header value, or undefined when empty. */
  getCookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /** True once a NextAuth session-token cookie has been captured/stored. */
  hasSessionCookie(): boolean {
    for (const name of this.cookies.keys()) {
      if (name.includes("session-token")) return true;
    }
    return false;
  }

  /** Parse `Set-Cookie` response headers and store each `name=value` pair. */
  private captureSetCookies(response: Response): void {
    const headers = response.headers as
      | (Headers & { getSetCookie?: () => string[] })
      | undefined;
    if (!headers) return;
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : typeof headers.get === "function"
          ? ((raw) => (raw ? [raw] : []))(headers.get("set-cookie"))
          : [];

    for (const cookie of setCookies) {
      const firstPair = cookie.split(";", 1)[0] ?? "";
      const eq = firstPair.indexOf("=");
      if (eq <= 0) continue;
      const name = firstPair.slice(0, eq).trim();
      const value = firstPair.slice(eq + 1).trim();
      // NextAuth clears cookies by setting an empty value — drop those.
      if (name && value) this.cookies.set(name, value);
      else if (name) this.cookies.delete(name);
    }
  }

  /**
   * Low-level fetch that returns the raw {@link Response} without the `{ data }`
   * envelope. Attaches stored cookies and captures `Set-Cookie`. Used by the auth
   * module for the NextAuth CSRF + credentials-callback endpoints, which do not
   * follow the standard envelope and rely on cookies.
   */
  async fetchRaw(
    method: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader && !headers.has("Cookie")) {
      headers.set("Cookie", cookieHeader);
    }
    const response = await this.fetchFn(url, { ...init, method, headers });
    this.captureSetCookies(response);
    return response;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const { data } = await this.requestRaw<T>(method, path, body, signal);
    return data;
  }

  async requestRaw<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<{ data: T; status: number }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const init: RequestInit = {
      method,
      headers,
      signal,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = serializeBody(body);
    }

    const response = await this.fetchFn(url, init);
    this.captureSetCookies(response);

    const status = response.status;

    // Treat 2xx as success
    if (status >= 200 && status < 300) {
      const payload = (await response.json()) as { data?: T };
      if (payload.data === undefined) {
        throw new HorizonMarketApiError(
          status,
          "Response missing required { data } envelope",
        );
      }
      return { data: payload.data, status };
    }

    // Error response
    let errorMessage: string;
    try {
      const payload = (await response.json()) as { error?: string };
      errorMessage = payload.error ?? response.statusText ?? "Unknown error";
    } catch {
      errorMessage = response.statusText ?? "Unknown error";
    }

    throw new HorizonMarketApiError(status, errorMessage);
  }
}
