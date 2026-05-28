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

  constructor(options: { baseUrl: string; fetch?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
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
