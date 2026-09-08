import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import {
  requestAccountDeletion,
  parseAccountDeletionAddresses,
} from "./account-deletion.js";
import { makeFetch } from "../test-utils.js";

function calls(fetchFn: typeof globalThis.fetch): [string, RequestInit][] {
  return (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
}

describe("requestAccountDeletion", () => {
  it("posts the trimmed body and maps a fresh request", async () => {
    const fetchFn = makeFetch(201, {
      data: { id: "del_1", status: "pending" },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const result = await requestAccountDeletion(http, {
      email: "  Me@Example.com  ",
      addresses: ["bc1qwallet", " bc1pwallet "],
      message: "  Please remove everything.  ",
    });

    const [url, init] = calls(fetchFn)[0];
    expect(url).toBe("https://horizon.market/api/account-deletion-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "Me@Example.com",
      addresses: ["bc1qwallet", "bc1pwallet"],
      message: "Please remove everything.",
    });
    expect(result).toEqual({
      id: "del_1",
      status: "pending",
      duplicate: false,
      verified: null,
    });
  });

  it("omits blank fields rather than sending empty strings", async () => {
    const fetchFn = makeFetch(201, { data: { id: "del_1", status: "pending" } });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await requestAccountDeletion(http, {
      email: "   ",
      addresses: ["bc1qwallet"],
      message: "   ",
    });
    expect(JSON.parse(calls(fetchFn)[0][1].body as string)).toEqual({
      addresses: ["bc1qwallet"],
    });
  });

  it("folds a duplicate address typed in two cases into one", async () => {
    const fetchFn = makeFetch(201, { data: { id: "del_1", status: "pending" } });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await requestAccountDeletion(http, {
      addresses: ["bc1qwallet", "BC1QWALLET", "bc1pwallet"],
    });
    expect(
      (JSON.parse(calls(fetchFn)[0][1].body as string) as { addresses: string[] })
        .addresses,
    ).toEqual(["bc1qwallet", "bc1pwallet"]);
  });

  it("maps a replay (200 + duplicate) as a success with no id", async () => {
    const fetchFn = makeFetch(200, {
      data: { status: "pending", duplicate: true, verified: true },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const result = await requestAccountDeletion(http, { email: "me@example.com" });
    expect(result).toEqual({
      id: null,
      status: "pending",
      duplicate: true,
      verified: true,
    });
  });

  it("refuses a request that names nothing, without a round-trip", async () => {
    const fetchFn = makeFetch(201, { data: { id: "del_1", status: "pending" } });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(
      requestAccountDeletion(http, { email: "  ", addresses: ["  "] }),
    ).rejects.toThrow(/email or at least one address/);
    expect(calls(fetchFn)).toHaveLength(0);
  });

  it("surfaces the server's throttle message", async () => {
    const fetchFn = makeFetch(429, {
      error: "Too many deletion requests from this address. Try again later, or email support.",
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(
      requestAccountDeletion(http, { email: "me@example.com" }),
    ).rejects.toThrow(/Too many deletion requests/);
  });
});

describe("parseAccountDeletionAddresses", () => {
  it("splits on newlines, commas and semicolons, dropping blanks", () => {
    expect(
      parseAccountDeletionAddresses(" bc1qone \n bc1ptwo,bc1qthree; \n\n bc1pfour "),
    ).toEqual(["bc1qone", "bc1ptwo", "bc1qthree", "bc1pfour"]);
  });

  it("is empty for empty or whitespace-only input", () => {
    expect(parseAccountDeletionAddresses("")).toEqual([]);
    expect(parseAccountDeletionAddresses("  \n ")).toEqual([]);
  });
});
