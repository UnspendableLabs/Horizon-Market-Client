import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  getMyProfile,
  updateMyProfile,
  checkUsernameAvailability,
  getMyAvatarDataUrl,
  uploadMyAvatar,
  listMyWallets,
  setWalletVisibility,
  listMyAssets,
  listMyLikedAssets,
  followAsset,
  unfollowAsset,
  getMyPoints,
  getPublicProfile,
  publicAvatarUrl,
  listPublicCuratedAssets,
  listPublicLikedAssets,
  listPublicProfileListings,
  listPublicProfilePurchases,
  isPlaceholderUsername,
} from "./profiles.js";
import { makeFetch } from "../test-utils.js";

// ─── Fixtures / helpers ──────────────────────────────────────────────────────

const WIRE_ME = {
  username: "alice",
  bio: "Collector of rare pepes.",
  is_public: true,
  x_username: "alice_x",
  avatar_url: "https://example.com/api/profiles/me/avatar",
  email: "alice@example.com",
  has_email: true,
  credits: 4,
  free_credits: 7,
  points_balance: 1200,
};

const WIRE_ASSET = {
  name: "RAREPEPE",
  asset_longname: "PEPENARDO.CARD",
  issuer: "bc1qissuer",
  issuer_username: "bob",
  description: "A card",
  divisible: false,
  supply: "21000000",
  holders: "42",
  image_url: "https://example.com/img.png",
  image_large_url: "https://example.com/img-large.png",
  price: 1500,
  floor_price: 1200,
  btc_volume: 0.5,
  trade_count: 9,
  collection: { id: 7, name: "Pepes", slug: "pepes" },
};

const WIRE_SWAP = {
  id: "swap-1",
  listing_type: "counterparty" as const,
  seller_address: "bc1qseller",
  buyer_address: null,
  asset_utxo_id: "txid:0",
  asset_utxo_value: 546,
  asset_name: "RAREPEPE",
  asset_quantity: 1,
  price: 100_000,
  price_per_unit: 100_000,
  psbt_hex: "70736274ff",
  tx_id: null,
  block_index: null,
  funded: true,
  filled: false,
  confirmed: false,
  delisted: false,
  seller_delisted: false,
  expired: false,
  pending: false,
  anomalous: false,
  royalty: null,
  expires_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  on_chain_payment: null,
};

function http(fetchFn: typeof globalThis.fetch): HttpClient {
  return new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
}

/** A raw (non-enveloped) response with real Headers — for the `fetchRaw` paths. */
function rawResponse(
  status: number,
  init: {
    json?: unknown;
    bytes?: Uint8Array;
    contentType?: string;
    statusText?: string;
  } = {},
): Response {
  const headers = new Headers();
  if (init.contentType) headers.set("content-type", init.contentType);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: init.statusText ?? "OK",
    headers,
    json: () =>
      init.json === undefined
        ? Promise.reject(new Error("not json"))
        : Promise.resolve(init.json),
    arrayBuffer: () =>
      Promise.resolve(
        (init.bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      ),
  } as unknown as Response;
}

function makeRawFetch(response: Response): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(response);
}

function lastCall(fetchFn: typeof globalThis.fetch): [string, RequestInit] {
  const mock = fetchFn as ReturnType<typeof vi.fn>;
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
}

// ─── The caller's own profile ────────────────────────────────────────────────

describe("getMyProfile", () => {
  it("unwraps the envelope and camelCases the payload", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_ME });

    const profile = await getMyProfile(http(fetchFn));

    expect(profile).toEqual({
      username: "alice",
      bio: "Collector of rare pepes.",
      isPublic: true,
      xUsername: "alice_x",
      avatarUrl: "https://example.com/api/profiles/me/avatar",
      email: "alice@example.com",
      hasEmail: true,
      credits: 4,
      freeCredits: 7,
      pointsBalance: 1200,
    });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/profiles/me");
    expect(init.method).toBe("GET");
  });

  it("sends the bearer token so the session-gated route authenticates", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_ME });
    const client = http(fetchFn);
    client.setBearerToken("jwt-123");

    await getMyProfile(client);

    const [, init] = lastCall(fetchFn);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt-123",
    );
  });

  it("surfaces a 401 as a HorizonMarketApiError", async () => {
    const fetchFn = makeFetch(401, { error: "Unauthorized" });

    await expect(getMyProfile(http(fetchFn))).rejects.toThrow(
      HorizonMarketApiError,
    );
  });
});

describe("updateMyProfile", () => {
  it("PATCHes only the supplied keys, snake_cased", async () => {
    const fetchFn = makeFetch(200, { data: { ...WIRE_ME, bio: "gm" } });

    const profile = await updateMyProfile(http(fetchFn), { bio: "gm" });

    expect(profile.bio).toBe("gm");
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/profiles/me");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ bio: "gm" });
  });

  it("maps isPublic to is_public and keeps `false` (not dropped as falsy)", async () => {
    const fetchFn = makeFetch(200, { data: { ...WIRE_ME, is_public: false } });

    const profile = await updateMyProfile(http(fetchFn), {
      username: "alice",
      isPublic: false,
    });

    expect(JSON.parse(lastCall(fetchFn)[1].body as string)).toEqual({
      username: "alice",
      is_public: false,
    });
    expect(profile.isPublic).toBe(false);
  });

  it("reports a taken username as a 409", async () => {
    const fetchFn = makeFetch(409, { error: "Username already taken" });

    await expect(
      updateMyProfile(http(fetchFn), { username: "taken" }),
    ).rejects.toMatchObject({ status: 409, error: "Username already taken" });
  });
});

describe("checkUsernameAvailability", () => {
  it("percent-encodes the name into the query", async () => {
    const fetchFn = makeFetch(200, {
      data: { username: "a,b", available: false },
    });

    const verdict = await checkUsernameAvailability(http(fetchFn), "a,b");

    expect(verdict).toEqual({ username: "a,b", available: false });
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/username-availability?username=a%2Cb",
    );
  });
});

describe("getMyAvatarDataUrl", () => {
  it("inlines the auth-gated bytes as a data URL", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        bytes: new Uint8Array([137, 80, 78, 71]),
        contentType: "image/png",
      }),
    );

    const dataUrl = await getMyAvatarDataUrl(http(fetchFn));

    expect(dataUrl).toBe("data:image/png;base64,iVBORw==");
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/profiles/me/avatar");
    expect(init.method).toBe("GET");
  });

  it("defaults the media type when the response carries none", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, { bytes: new Uint8Array([1, 2, 3]) }),
    );

    expect(await getMyAvatarDataUrl(http(fetchFn))).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("returns null when no avatar is set", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(404, { json: { error: "No avatar set" } }),
    );

    expect(await getMyAvatarDataUrl(http(fetchFn))).toBeNull();
  });

  it("returns null on an empty body rather than an empty data URL", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { contentType: "image/png" }));

    expect(await getMyAvatarDataUrl(http(fetchFn))).toBeNull();
  });

  it("throws with the server message on any other failure", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(500, { json: { error: "boom" }, statusText: "Server Error" }),
    );

    await expect(getMyAvatarDataUrl(http(fetchFn))).rejects.toMatchObject({
      status: 500,
      error: "boom",
    });
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    const fetchFn = makeRawFetch(rawResponse(503, { statusText: "Unavailable" }));

    await expect(getMyAvatarDataUrl(http(fetchFn))).rejects.toMatchObject({
      error: "Unavailable",
    });
  });
});

describe("uploadMyAvatar", () => {
  it("PUTs multipart form data and returns the new URL", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        json: { data: { avatar_url: "https://example.com/api/profiles/me/avatar" } },
      }),
    );

    const result = await uploadMyAvatar(
      http(fetchFn),
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    );

    expect(result).toEqual({
      avatarUrl: "https://example.com/api/profiles/me/avatar",
    });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/profiles/me/avatar");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(FormData);
    // The multipart boundary is fetch's to generate — setting Content-Type here
    // would produce a body the server cannot parse.
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
    const file = (init.body as FormData).get("image") as File;
    expect(file.name).toBe("avatar.png");
  });

  it("keeps a File's own name", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, { json: { data: { avatar_url: "https://x/y" } } }),
    );

    await uploadMyAvatar(
      http(fetchFn),
      new File([new Uint8Array([1])], "selfie.jpg", { type: "image/jpeg" }),
    );

    const file = (lastCall(fetchFn)[1].body as FormData).get("image") as File;
    expect(file.name).toBe("selfie.jpg");
  });

  it("sends a blob that also carries a uri as a blob", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, { json: { data: { avatar_url: "https://x/y" } } }),
    );

    // What `expo-file-system`'s `File` is: a blob with a `uri` on it. Expo's
    // fetch sends blobs and refuses the descriptor, so a value answering to
    // both has to take the blob branch.
    await uploadMyAvatar(
      http(fetchFn),
      Object.assign(
        new File([new Uint8Array([1])], "selfie.jpg", { type: "image/jpeg" }),
        { uri: "file:///tmp/selfie.jpg" },
      ),
    );

    const file = (lastCall(fetchFn)[1].body as FormData).get("image") as File;
    expect(file.name).toBe("selfie.jpg");
  });

  it("accepts a React Native picker descriptor", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, { json: { data: { avatar_url: "https://x/y" } } }),
    );

    await uploadMyAvatar(http(fetchFn), {
      uri: "file:///tmp/pic.jpg",
      name: "pic.jpg",
      type: "image/jpeg",
    });

    // Node's FormData stringifies a non-Blob value; asserting on it proves the
    // descriptor (not a Blob) is what got appended — which is what RN's fetch
    // needs to stream the file off disk.
    const appended = (lastCall(fetchFn)[1].body as FormData).get("image");
    expect(String(appended)).toContain("[object Object]");
  });

  it("defaults name and type for a bare RN uri", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, { json: { data: { avatar_url: "https://x/y" } } }),
    );

    await expect(
      uploadMyAvatar(http(fetchFn), { uri: "file:///tmp/pic" }),
    ).resolves.toEqual({ avatarUrl: "https://x/y" });
  });

  it("surfaces the server's rejection message", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(400, { json: { error: "Image size must be less than 5MB" } }),
    );

    await expect(
      uploadMyAvatar(http(fetchFn), new Blob([new Uint8Array([1])])),
    ).rejects.toMatchObject({
      status: 400,
      error: "Image size must be less than 5MB",
    });
  });

  it("refuses a 200 that carries no avatar_url", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { json: { data: {} } }));

    await expect(
      uploadMyAvatar(http(fetchFn), new Blob([new Uint8Array([1])])),
    ).rejects.toThrow(/no avatar_url/);
  });
});

// ─── Linked wallets ──────────────────────────────────────────────────────────

describe("listMyWallets", () => {
  it("maps every wallet", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        wallets: [
          {
            address: "bc1qwallet",
            wallet_provider: "horizon-market-client",
            taproot_address: "bc1pwallet",
            is_public: true,
            created_at: "2026-01-02T03:04:05.000Z",
          },
        ],
      },
    });

    await expect(listMyWallets(http(fetchFn))).resolves.toEqual([
      {
        address: "bc1qwallet",
        walletProvider: "horizon-market-client",
        taprootAddress: "bc1pwallet",
        isPublic: true,
        createdAt: "2026-01-02T03:04:05.000Z",
      },
    ]);
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/wallets",
    );
  });

  it("tolerates a payload without a wallets array", async () => {
    const fetchFn = makeFetch(200, { data: {} });

    await expect(listMyWallets(http(fetchFn))).resolves.toEqual([]);
  });
});

describe("setWalletVisibility", () => {
  it("PATCHes the encoded address with an explicit is_public", async () => {
    const fetchFn = makeFetch(200, {
      data: { address: "bc1qwallet", is_public: false },
    });

    const result = await setWalletVisibility(
      http(fetchFn),
      "bc1qwallet",
      false,
    );

    expect(result).toEqual({ address: "bc1qwallet", isPublic: false });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/profiles/me/wallets/bc1qwallet");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ is_public: false });
  });

  it("reports an unlinked address as a 404", async () => {
    const fetchFn = makeFetch(404, { error: "Wallet not found" });

    await expect(
      setWalletVisibility(http(fetchFn), "bc1qother", true),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── Asset lists ─────────────────────────────────────────────────────────────

describe("listMyAssets", () => {
  it("maps the page and threads offset/limit into the query", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        assets: [WIRE_ASSET],
        pagination: { total: 31, offset: 10, limit: 5 },
      },
    });

    const page = await listMyAssets(http(fetchFn), { offset: 10, limit: 5 });

    expect(page.pagination).toEqual({ total: 31, offset: 10, limit: 5 });
    expect(page.assets[0]).toEqual({
      name: "RAREPEPE",
      assetLongname: "PEPENARDO.CARD",
      issuer: "bc1qissuer",
      issuerUsername: "bob",
      description: "A card",
      divisible: false,
      supply: "21000000",
      holders: "42",
      imageUrl: "https://example.com/img.png",
      imageLargeUrl: "https://example.com/img-large.png",
      price: 1500,
      floorPrice: 1200,
      btcVolume: 0.5,
      tradeCount: 9,
      collection: { id: 7, name: "Pepes", slug: "pepes" },
    });
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/assets?offset=10&limit=5",
    );
  });

  it("omits the query entirely when unpaged", async () => {
    const fetchFn = makeFetch(200, {
      data: { assets: [], pagination: { total: 0, offset: 0, limit: 50 } },
    });

    await listMyAssets(http(fetchFn));

    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/assets",
    );
  });

  it("keeps offset=0 in the query (not dropped as falsy)", async () => {
    const fetchFn = makeFetch(200, {
      data: { assets: [], pagination: { total: 0, offset: 0, limit: 50 } },
    });

    await listMyAssets(http(fetchFn), { offset: 0 });

    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/assets?offset=0",
    );
  });
});

describe("listMyLikedAssets", () => {
  it("reads the liked-assets route and tolerates a missing assets array", async () => {
    const fetchFn = makeFetch(200, {
      data: { pagination: { total: 0, offset: 0, limit: 50 } },
    });

    const page = await listMyLikedAssets(http(fetchFn), { limit: 20 });

    expect(page.assets).toEqual([]);
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/liked-assets?limit=20",
    );
  });
});

describe("followAsset / unfollowAsset", () => {
  it("PUTs the encoded asset name", async () => {
    const fetchFn = makeFetch(200, {
      data: { asset: "PEPE.CARD", followed: true },
    });

    await expect(followAsset(http(fetchFn), "PEPE.CARD")).resolves.toEqual({
      asset: "PEPE.CARD",
      followed: true,
    });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(
      "https://example.com/api/profiles/me/liked-assets/PEPE.CARD",
    );
    expect(init.method).toBe("PUT");
  });

  it("DELETEs to unfollow", async () => {
    const fetchFn = makeFetch(200, {
      data: { asset: "RAREPEPE", followed: false },
    });

    await expect(unfollowAsset(http(fetchFn), "RAREPEPE")).resolves.toEqual({
      asset: "RAREPEPE",
      followed: false,
    });
    expect(lastCall(fetchFn)[1].method).toBe("DELETE");
  });
});

// ─── Points ──────────────────────────────────────────────────────────────────

describe("getMyPoints", () => {
  it("maps the balance block, the history and the pagination", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        balance: { points: 900, confirmed_total: 1000, spent_total: 100 },
        confirmed_total: 1000,
        pending_total: 50,
        points_multiplier_remaining_ms: 3600,
        reward_actions: [
          {
            id: "ra-1",
            action_id: "profile-setup",
            event_id: null,
            reward: 500,
            status: "confirmed",
            created_at: "2026-02-03T00:00:00.000Z",
          },
        ],
        pagination: { total: 1, offset: 0, limit: 20 },
      },
    });

    const summary = await getMyPoints(http(fetchFn), { limit: 20 });

    expect(summary.balance).toEqual({
      points: 900,
      confirmedTotal: 1000,
      spentTotal: 100,
    });
    expect(summary.confirmedTotal).toBe(1000);
    expect(summary.pendingTotal).toBe(50);
    expect(summary.pointsMultiplierRemainingMs).toBe(3600);
    expect(summary.rewardActions).toEqual([
      {
        id: "ra-1",
        actionId: "profile-setup",
        eventId: null,
        reward: 500,
        status: "confirmed",
        createdAt: "2026-02-03T00:00:00.000Z",
      },
    ]);
    expect(summary.pagination).toEqual({ total: 1, offset: 0, limit: 20 });
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/me/points?limit=20",
    );
  });

  it("tolerates a payload with no reward actions", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        balance: { points: 0, confirmed_total: 0, spent_total: 0 },
        confirmed_total: 0,
        pending_total: 0,
        points_multiplier_remaining_ms: 0,
        pagination: { total: 0, offset: 0, limit: 20 },
      },
    });

    await expect(
      getMyPoints(http(fetchFn)).then((s) => s.rewardActions),
    ).resolves.toEqual([]);
  });
});

// ─── Public profiles ─────────────────────────────────────────────────────────

describe("getPublicProfile", () => {
  it("maps a public profile", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        json: {
          data: {
            username: "alice",
            bio: null,
            x_username: null,
            avatar_url: "https://example.com/api/profiles/alice/avatar",
            public_addresses: ["bc1qwallet"],
            points_balance: 12,
            has_exclusive_badge: true,
          },
        },
      }),
    );

    await expect(getPublicProfile(http(fetchFn), "Alice")).resolves.toEqual({
      username: "alice",
      bio: null,
      xUsername: null,
      avatarUrl: "https://example.com/api/profiles/alice/avatar",
      publicAddresses: ["bc1qwallet"],
      pointsBalance: 12,
      hasExclusiveBadge: true,
    });
    expect(lastCall(fetchFn)[0]).toBe("https://example.com/api/profiles/Alice");
  });

  it("returns null for a private or unknown profile (both 404 by design)", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(404, { json: { error: "Profile not found" } }),
    );

    await expect(getPublicProfile(http(fetchFn), "ghost")).resolves.toBeNull();
  });

  it("defaults public_addresses to an empty array", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(200, {
        json: {
          data: {
            username: "alice",
            bio: null,
            x_username: null,
            avatar_url: null,
            points_balance: 0,
            has_exclusive_badge: false,
          },
        },
      }),
    );

    await expect(
      getPublicProfile(http(fetchFn), "alice").then((p) => p?.publicAddresses),
    ).resolves.toEqual([]);
  });

  it("throws on a server error rather than reporting 'no such profile'", async () => {
    const fetchFn = makeRawFetch(rawResponse(500, { json: { error: "boom" } }));

    await expect(getPublicProfile(http(fetchFn), "alice")).rejects.toMatchObject(
      { status: 500, error: "boom" },
    );
  });

  it("throws when the 200 carries no { data } envelope", async () => {
    const fetchFn = makeRawFetch(rawResponse(200, { json: {} }));

    await expect(getPublicProfile(http(fetchFn), "alice")).rejects.toThrow(
      /data/,
    );
  });
});

describe("publicAvatarUrl", () => {
  it("strips a trailing slash and encodes the username", async () => {
    expect(publicAvatarUrl("https://example.com/", "a b")).toBe(
      "https://example.com/api/profiles/a%20b/avatar",
    );
  });
});

describe("public sub-resources", () => {
  it("reads a profile's curated showcase", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        assets: [WIRE_ASSET],
        pagination: { total: 1, offset: 0, limit: 50 },
      },
    });

    const page = await listPublicCuratedAssets(http(fetchFn), "alice", {
      limit: 50,
    });

    expect(page.assets[0].name).toBe("RAREPEPE");
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/alice/curated-assets?limit=50",
    );
  });

  it("reads a profile's liked assets", async () => {
    const fetchFn = makeFetch(200, {
      data: { assets: [], pagination: { total: 0, offset: 0, limit: 50 } },
    });

    await listPublicLikedAssets(http(fetchFn), "alice");

    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/alice/liked-assets",
    );
  });

  it("maps listings into the same swap shape listSwaps returns", async () => {
    const fetchFn = makeFetch(200, {
      data: {
        atomic_swaps: [WIRE_SWAP],
        pagination: { total: 1, offset: 0, limit: 50 },
      },
    });

    const page = await listPublicProfileListings(http(fetchFn), "alice");

    expect(page.atomicSwaps[0]).toMatchObject({
      id: "swap-1",
      sellerAddress: "bc1qseller",
      assetName: "RAREPEPE",
      assetQuantity: 1n,
      pricePerUnit: 100_000,
    });
    expect(page.pagination).toEqual({ total: 1, offset: 0, limit: 50 });
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/alice/listings",
    );
  });

  it("reads a profile's purchases and tolerates a missing swaps array", async () => {
    const fetchFn = makeFetch(200, {
      data: { pagination: { total: 0, offset: 0, limit: 50 } },
    });

    const page = await listPublicProfilePurchases(http(fetchFn), "alice", {
      offset: 50,
    });

    expect(page.atomicSwaps).toEqual([]);
    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/profiles/alice/purchases?offset=50",
    );
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe("isPlaceholderUsername", () => {
  it("treats the account-creation UUID and a missing name as unset", () => {
    expect(isPlaceholderUsername(null)).toBe(true);
    expect(isPlaceholderUsername("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
      true,
    );
    expect(isPlaceholderUsername("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(
      true,
    );
  });

  it("treats a chosen name as set", () => {
    expect(isPlaceholderUsername("alice")).toBe(false);
    expect(isPlaceholderUsername("3f2504e0-4f89-11d3-9a0c")).toBe(false);
  });
});
