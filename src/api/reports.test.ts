import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import {
  reportListing,
  findReportableListingId,
  reportableListingQueryFor,
  LISTING_REPORT_REASONS,
  LISTING_REPORT_REASON_LABELS,
} from "./reports.js";
import { makeFetch, makeSequentialFetch } from "../test-utils.js";

const SWAP_ID = "8f14e45f-ceea-467a-9c1f-2b0c1d0f5a11";

function calls(fetchFn: typeof globalThis.fetch): [string, RequestInit][] {
  return (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
}

describe("reportListing", () => {
  it("posts the snake_case body and maps a fresh report", async () => {
    const fetchFn = makeFetch(201, {
      data: { id: "rep_1", status: "pending", atomic_swap_id: SWAP_ID },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const result = await reportListing(http, {
      atomicSwapId: SWAP_ID,
      reason: "scam",
      details: "  Impersonates a well-known collection.  ",
    });

    const [url, init] = calls(fetchFn)[0];
    expect(url).toBe("https://horizon.market/api/reports");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      atomic_swap_id: SWAP_ID,
      reason: "scam",
      details: "Impersonates a well-known collection.",
    });
    expect(result).toEqual({
      id: "rep_1",
      status: "pending",
      atomicSwapId: SWAP_ID,
      duplicate: false,
    });
  });

  it("omits `details` when it is absent or blank", async () => {
    const fetchFn = makeFetch(201, {
      data: { id: "rep_1", status: "pending", atomic_swap_id: SWAP_ID },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await reportListing(http, { atomicSwapId: SWAP_ID, reason: "spam", details: "   " });
    expect(JSON.parse(calls(fetchFn)[0][1].body as string)).toEqual({
      atomic_swap_id: SWAP_ID,
      reason: "spam",
    });
  });

  it("maps a replay (200 + duplicate) as a success with no id", async () => {
    const http = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: makeFetch(200, {
        data: { status: "pending", atomic_swap_id: SWAP_ID, duplicate: true },
      }),
    });
    await expect(
      reportListing(http, { atomicSwapId: SWAP_ID, reason: "other" }),
    ).resolves.toEqual({
      id: null,
      status: "pending",
      atomicSwapId: SWAP_ID,
      duplicate: true,
    });
  });

  it("surfaces 401 (no session) as an API error", async () => {
    const http = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: makeFetch(401, { error: "Unauthorized" }),
    });
    await expect(
      reportListing(http, { atomicSwapId: SWAP_ID, reason: "hate" }),
    ).rejects.toMatchObject({ status: 401, error: "Unauthorized" });
  });

  it("forwards the abort signal", async () => {
    const fetchFn = makeFetch(201, {
      data: { id: "rep_1", status: "pending", atomic_swap_id: SWAP_ID },
    });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    const controller = new AbortController();
    await reportListing(
      http,
      { atomicSwapId: SWAP_ID, reason: "scam" },
      { signal: controller.signal },
    );
    expect(calls(fetchFn)[0][1].signal).toBe(controller.signal);
  });
});

describe("reason catalogue", () => {
  it("labels every reason, in the order the form offers them", () => {
    expect(LISTING_REPORT_REASONS).toEqual([
      "scam",
      "illegal",
      "sexual",
      "violence",
      "hate",
      "impersonation",
      "spam",
      "other",
    ]);
    for (const reason of LISTING_REPORT_REASONS) {
      expect(LISTING_REPORT_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe("findReportableListingId", () => {
  const empty = { count: 0, atomic_swaps: [], pagination: { total: 0, offset: 0, limit: 1 } };
  const page = (id: string) => ({
    count: 1,
    atomic_swaps: [{ id, listing_type: "counterparty", seller_address: "bc1q", asset_name: "RAREPEPE" }],
    pagination: { total: 1, offset: 0, limit: 1 },
  });

  it("takes an open offer when there is one, in a single request", async () => {
    const fetchFn = makeFetch(200, { data: page("swap_open") });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(
      findReportableListingId(http, { assetName: "RAREPEPE", listingType: "counterparty" }),
    ).resolves.toBe("swap_open");
    expect(calls(fetchFn)).toHaveLength(1);
    const url = new URL(calls(fetchFn)[0][0]);
    expect(url.pathname).toBe("/api/atomic-swaps");
    expect(url.searchParams.get("asset_name")).toBe("RAREPEPE");
    expect(url.searchParams.get("listing_type")).toBe("counterparty");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.has("sales")).toBe(false);
    expect(url.searchParams.has("delisted")).toBe(false);
  });

  it("falls back to a completed sale, then a delisted offer", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: empty } },
      { status: 200, body: { data: empty } },
      { status: 200, body: { data: page("swap_delisted") } },
    );
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(
      findReportableListingId(http, { kontorNftId: "nft_1", listingType: "kontor" }),
    ).resolves.toBe("swap_delisted");
    const urls = fetchFn.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls).toHaveLength(3);
    expect(urls[0].searchParams.get("kontor_nft_id")).toBe("nft_1");
    expect(urls[1].searchParams.get("sales")).toBe("true");
    expect(urls[2].searchParams.get("delisted")).toBe("true");
  });

  it("is null for a token that was never listed", async () => {
    const http = new HttpClient({
      baseUrl: "https://horizon.market",
      fetch: makeFetch(200, { data: empty }),
    });
    await expect(
      findReportableListingId(http, { assetName: "NEVERLISTED" }),
    ).resolves.toBeNull();
  });

  it("identifies KOR by type + kind alone", async () => {
    const fetchFn = makeFetch(200, { data: page("swap_kor") });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(
      findReportableListingId(http, { listingType: "kontor", kontorAssetKind: "token" }),
    ).resolves.toBe("swap_kor");
    const url = new URL(calls(fetchFn)[0][0]);
    expect(url.searchParams.get("kontor_asset_kind")).toBe("token");
  });

  it("refuses to pick an arbitrary listing when nothing narrows the query", async () => {
    const fetchFn = makeFetch(200, { data: page("swap_any") });
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch: fetchFn });
    await expect(findReportableListingId(http, {})).resolves.toBeNull();
    await expect(
      findReportableListingId(http, { listingType: "kontor" }),
    ).resolves.toBeNull();
    expect(calls(fetchFn)).toHaveLength(0);
  });
});

describe("reportableListingQueryFor", () => {
  const token = (atomicSwapsQuery: Record<string, string>) => ({
    offers: { count: 0, floorPriceSats: null, webUrl: "", atomicSwapsQuery },
  });

  it("keeps only the keys that identify the asset", () => {
    expect(
      reportableListingQueryFor(
        token({
          asset_name: "RAREPEPE",
          listing_type: "counterparty",
          expired: "false",
          exclude_pending: "true",
        }),
      ),
    ).toEqual({ assetName: "RAREPEPE", listingType: "counterparty" });
  });

  it("carries a Kontor NFT id and the KOR kind", () => {
    expect(
      reportableListingQueryFor(
        token({ kontor_nft_id: "nft_1", listing_type: "kontor" }),
      ),
    ).toEqual({ kontorNftId: "nft_1", listingType: "kontor" });
    expect(
      reportableListingQueryFor(
        token({ listing_type: "kontor", kontor_asset_kind: "token" }),
      ),
    ).toEqual({ listingType: "kontor", kontorAssetKind: "token" });
  });
});
