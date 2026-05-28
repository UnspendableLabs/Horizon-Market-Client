import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import { startDelist, confirmDelist } from "./delist.js";
import { makeFetch } from "../test-utils.js";

describe("startDelist", () => {
  it("maps wire delist request to domain type", async () => {
    const wire = {
      id: "dr_abc123",
      atomic_swap: { id: "swap_abc", seller_address: "bc1qseller" },
    };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(201, { data: wire }),
    });
    const req = await startDelist(http, "swap_abc");
    expect(req).toEqual({
      id: "dr_abc123",
      atomicSwap: { id: "swap_abc", sellerAddress: "bc1qseller" },
    });
  });

  it("posts to correct URL with empty body", async () => {
    const fetchFn = makeFetch(201, {
      data: { id: "dr_1", atomic_swap: { id: "swap_abc", seller_address: "bc1q" } },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await startDelist(http, "swap_xyz");
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://horizon.market/api/atomic-swaps/swap_xyz/delist-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});

describe("confirmDelist", () => {
  it("maps wire confirm result to domain type", async () => {
    const wire = { id: "dr_abc123", signature: "base64sig==" };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(201, { data: wire }),
    });
    const result = await confirmDelist(http, "dr_abc123", "base64sig==");
    expect(result).toEqual({ id: "dr_abc123", signature: "base64sig==" });
  });

  it("maps null signature from wire response", async () => {
    const wire = { id: "dr_abc123", signature: null };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(201, { data: wire }),
    });
    const result = await confirmDelist(http, "dr_abc123", "base64sig==");
    expect(result.signature).toBeNull();
  });

  it("puts to correct URL with flat signature body", async () => {
    const fetchFn = makeFetch(201, { data: { id: "dr_1", signature: "sig" } });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await confirmDelist(http, "dr_abc", "my_sig");
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://horizon.market/api/atomic-swaps/delist-requests/dr_abc");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ signature: "my_sig" });
  });
});
