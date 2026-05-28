import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import { makeFetch } from "../test-utils.js";

describe("HorizonMarketApiError", () => {
  it("has correct name, status and error", () => {
    const err = new HorizonMarketApiError(404, "Not found");
    expect(err.name).toBe("HorizonMarketApiError");
    expect(err.status).toBe(404);
    expect(err.error).toBe("Not found");
    expect(err.message).toBe("HTTP 404: Not found");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof HorizonMarketApiError).toBe(true);
  });
});

describe("HttpClient", () => {
  it("unwraps { data } on 200", async () => {
    const fetch = makeFetch(200, { data: { hello: "world" } });
    const client = new HttpClient({ baseUrl: "https://example.com", fetch });
    const result = await client.request<{ hello: string }>("GET", "/foo");
    expect(result).toEqual({ hello: "world" });
  });

  it("unwraps { data } on 201 and returns status", async () => {
    const fetch = makeFetch(201, { data: { id: "abc" } });
    const client = new HttpClient({ baseUrl: "https://example.com", fetch });
    const { data, status } = await client.requestRaw<{ id: string }>(
      "POST",
      "/foo",
      { x: 1 },
    );
    expect(data).toEqual({ id: "abc" });
    expect(status).toBe(201);
  });

  it("throws HorizonMarketApiError on 4xx with { error }", async () => {
    const fetch = makeFetch(404, { error: "Atomic swap not found" });
    const client = new HttpClient({ baseUrl: "https://example.com", fetch });
    await expect(client.request("GET", "/missing")).rejects.toThrow(
      HorizonMarketApiError,
    );
    await expect(client.request("GET", "/missing")).rejects.toMatchObject({
      status: 404,
      error: "Atomic swap not found",
    });
  });

  it("throws HorizonMarketApiError on 500 with { error }", async () => {
    const fetch = makeFetch(500, { error: "Internal server error" });
    const client = new HttpClient({ baseUrl: "https://example.com", fetch });
    await expect(client.request("GET", "/error")).rejects.toThrow(
      HorizonMarketApiError,
    );
    await expect(client.request("GET", "/error")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("sends correct URL and method", async () => {
    const fetchFn = makeFetch(200, { data: {} });
    const client = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: fetchFn,
    });
    await client.request("GET", "/api/atomic-swaps");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://horizon.market/api/atomic-swaps",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("serializes bigint in body as number when <= MAX_SAFE_INTEGER", async () => {
    const fetchFn = makeFetch(200, { data: {} });
    const client = new HttpClient({
      baseUrl: "https://example.com",
      fetch: fetchFn,
    });
    await client.request("POST", "/foo", { qty: 1000n });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe('{"qty":1000}');
  });

  it("serializes bigint in body as string when > MAX_SAFE_INTEGER", async () => {
    const fetchFn = makeFetch(200, { data: {} });
    const client = new HttpClient({
      baseUrl: "https://example.com",
      fetch: fetchFn,
    });
    const bigQty = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await client.request("POST", "/foo", { qty: bigQty });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe(`{"qty":"${bigQty.toString()}"}`);
  });

  it("trims trailing slash from baseUrl", async () => {
    const fetchFn = makeFetch(200, { data: {} });
    const client = new HttpClient({
      baseUrl: "https://example.com/",
      fetch: fetchFn,
    });
    await client.request("GET", "/api/test");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.com/api/test",
      expect.anything(),
    );
  });
});
