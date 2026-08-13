import {
  HttpClient,
  HorizonMarketApiError,
  appendFilePart,
  readErrorMessage,
} from "./http.js";
import { base64 } from "@scure/base";
import { mapAtomicSwap, type WireAtomicSwap } from "./atomic-swaps.js";
import type {
  AtomicSwap,
  Pagination,
  RequestOptions,
} from "../types/index.js";

/**
 * User profiles — `/api/profiles/*`.
 *
 * Two surfaces sit behind this module:
 *
 * - `/api/profiles/me/*` is **session-gated**. There is no on-chain signature to
 *   stand in for authentication here (unlike the atomic-swap endpoints), so the
 *   caller must be signed in — `client.signInWithWallet()` mints the bearer token
 *   the {@link HttpClient} then attaches to every request.
 * - `/api/profiles/{username}/*` is public and unauthenticated. It only serves
 *   profiles whose owner set `isPublic`; a private profile and an unknown one are
 *   deliberately indistinguishable (both 404), so nothing here reveals that an
 *   account exists.
 *
 * Avatars are never inlined in JSON: every payload carries an `avatarUrl` (or
 * `null`). A public avatar URL can be handed straight to an `<img>`; the caller's
 * own avatar is auth-gated, hence {@link getMyAvatarDataUrl}.
 */

// ─── Wire types (snake_case, internal only) ──────────────────────────────────

interface WireMyProfile {
  username: string | null;
  bio: string | null;
  is_public: boolean;
  x_username: string | null;
  avatar_url: string | null;
  email: string | null;
  has_email: boolean;
  credits: number;
  free_credits: number;
  points_balance: number;
}

interface WirePublicProfile {
  username: string;
  bio: string | null;
  x_username: string | null;
  avatar_url: string | null;
  public_addresses: string[];
  points_balance: number;
  has_exclusive_badge: boolean;
}

interface WireProfileWallet {
  address: string;
  wallet_provider: string | null;
  taproot_address: string | null;
  is_public: boolean;
  created_at: string;
}

interface WireProfileAsset {
  name: string;
  asset_longname: string | null;
  issuer: string | null;
  issuer_username: string | null;
  description: string | null;
  divisible: boolean;
  supply: string | null;
  holders: string | null;
  image_url: string | null;
  image_large_url: string | null;
  price: number | null;
  floor_price: number | null;
  btc_volume: number | null;
  trade_count: number | null;
  collection: {
    id: number | string;
    name: string | null;
    slug: string | null;
  } | null;
}

interface WirePagination {
  total: number;
  offset: number;
  limit: number | null;
}

interface WireAssetPage {
  assets: WireProfileAsset[];
  pagination: WirePagination;
}

interface WireSwapPage {
  atomic_swaps: WireAtomicSwap[];
  pagination: WirePagination;
}

interface WireRewardAction {
  id: string;
  action_id: string;
  event_id: string | null;
  reward: number;
  status: RewardActionStatus;
  created_at: string;
}

interface WirePointsSummary {
  balance: {
    points: number;
    confirmed_total: number;
    spent_total: number;
  };
  confirmed_total: number;
  pending_total: number;
  points_multiplier_remaining_ms: number;
  reward_actions: WireRewardAction[];
  pagination: WirePagination;
}

// ─── Domain types ────────────────────────────────────────────────────────────

/** The authenticated account's own profile (`GET /api/profiles/me`). */
export interface MyProfile {
  /**
   * A freshly-created account gets a random UUID username until it is changed,
   * so a UUID-looking value means "never set" — see {@link isPlaceholderUsername}.
   */
  username: string | null;
  bio: string | null;
  /** Whether `/api/profiles/{username}` serves this profile at all. */
  isPublic: boolean;
  /** Linked X/Twitter handle. Read-only: linking is a web-only OAuth flow. */
  xUsername: string | null;
  /** `GET /api/profiles/me/avatar` (auth-gated), or `null` when none is set. */
  avatarUrl: string | null;
  email: string | null;
  hasEmail: boolean;
  credits: number;
  /** Nightly-replenished listing credits. */
  freeCredits: number;
  pointsBalance: number;
}

/** A public profile (`GET /api/profiles/{username}`). */
export interface PublicProfile {
  username: string;
  bio: string | null;
  xUsername: string | null;
  avatarUrl: string | null;
  /**
   * Wallet addresses the owner marked public — what the `listings` and
   * `purchases` sub-resources query. Empty means those return empty lists.
   */
  publicAddresses: string[];
  pointsBalance: number;
  hasExclusiveBadge: boolean;
}

/** Partial profile update. At least one field must be present. */
export interface UpdateMyProfileParams {
  /** Lowercase letters, digits, `_`, `-` and `,`; 1–30 chars. `me` is reserved. */
  username?: string;
  /** Up to 500 characters. */
  bio?: string;
  isPublic?: boolean;
}

/** A wallet linked to the account (`GET /api/profiles/me/wallets`). */
export interface ProfileWallet {
  address: string;
  walletProvider: string | null;
  taprootAddress: string | null;
  /** Whether the address appears in the public profile's `publicAddresses`. */
  isPublic: boolean;
  createdAt: string;
}

/** An asset row as the profile lists return it. */
export interface ProfileAsset {
  name: string;
  /** Set for Counterparty subassets; display this in preference to `name`. */
  assetLongname: string | null;
  issuer: string | null;
  /** The issuer's public profile username, when it has one. */
  issuerUsername: string | null;
  description: string | null;
  divisible: boolean;
  /** A string — supplies exceed the safe integer range. */
  supply: string | null;
  holders: string | null;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  /** Last trade price in sats. */
  price: number | null;
  floorPrice: number | null;
  /** Rolling one-month BTC volume. */
  btcVolume: number | null;
  tradeCount: number | null;
  collection: {
    id: number | string;
    name: string | null;
    slug: string | null;
  } | null;
}

/** A page of assets, with the total across the whole list. */
export interface ProfileAssetPage {
  assets: ProfileAsset[];
  pagination: Pagination;
}

/** A page of swaps, in the same shape `client.listSwaps()` returns. */
export interface ProfileSwapPage {
  atomicSwaps: AtomicSwap[];
  pagination: Pagination;
}

export type RewardActionStatus = "pending" | "confirmed" | "cancelled";

/** One rewarded action in the points history. */
export interface RewardAction {
  id: string;
  /** The rewarded action, e.g. `profile-setup`. */
  actionId: string;
  eventId: string | null;
  /** Points granted. */
  reward: number;
  status: RewardActionStatus;
  createdAt: string;
}

/** Points balance + reward history (`GET /api/profiles/me/points`). */
export interface PointsSummary {
  /** Whole-account balance, unaffected by pagination. */
  balance: {
    /** Spendable balance — `confirmedTotal` minus `spentTotal`. */
    points: number;
    confirmedTotal: number;
    /** Points already redeemed in the rewards catalog. */
    spentTotal: number;
  };
  /**
   * Confirmed points across `rewardActions`. Not the same number as
   * `balance.confirmedTotal`, which also accounts for redemptions.
   */
  confirmedTotal: number;
  pendingTotal: number;
  /** Milliseconds left on an active points multiplier; `0` when inactive. */
  pointsMultiplierRemainingMs: number;
  rewardActions: RewardAction[];
  pagination: Pagination;
}

/** Verdict from `GET /api/profiles/me/username-availability`. */
export interface UsernameAvailability {
  username: string;
  available: boolean;
}

/** Result of following / unfollowing an asset. */
export interface FollowState {
  asset: string;
  followed: boolean;
}

/** Offset/limit page request. `limit` is capped at 100 server-side. */
export interface ProfilePageParams {
  offset?: number;
  limit?: number;
}

/**
 * An avatar to upload: a `Blob`/`File` (browser, Node) or a React Native file
 * descriptor (`{ uri }` from an image picker). Re-encoded server-side to a
 * 512×512 PNG, so the source aspect ratio is not preserved. Max 5 MB.
 *
 * On Expo, prefer the blob: `expo/fetch` cannot encode the `{ uri }` descriptor.
 */
export type AvatarUpload =
  | Blob
  | { uri: string; name?: string; type?: string };

/** Where {@link uploadMyAvatar} left the new image. */
export interface AvatarUploadResult {
  avatarUrl: string;
}

/** New visibility of a wallet after {@link setWalletVisibility}. */
export interface WalletVisibility {
  address: string;
  isPublic: boolean;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapPagination(wire: WirePagination): Pagination {
  return { total: wire.total, offset: wire.offset, limit: wire.limit };
}

function mapMyProfile(wire: WireMyProfile): MyProfile {
  return {
    username: wire.username,
    bio: wire.bio,
    isPublic: wire.is_public,
    xUsername: wire.x_username,
    avatarUrl: wire.avatar_url,
    email: wire.email,
    hasEmail: wire.has_email,
    credits: wire.credits,
    freeCredits: wire.free_credits,
    pointsBalance: wire.points_balance,
  };
}

function mapPublicProfile(wire: WirePublicProfile): PublicProfile {
  return {
    username: wire.username,
    bio: wire.bio,
    xUsername: wire.x_username,
    avatarUrl: wire.avatar_url,
    publicAddresses: wire.public_addresses ?? [],
    pointsBalance: wire.points_balance,
    hasExclusiveBadge: wire.has_exclusive_badge,
  };
}

function mapWallet(wire: WireProfileWallet): ProfileWallet {
  return {
    address: wire.address,
    walletProvider: wire.wallet_provider,
    taprootAddress: wire.taproot_address,
    isPublic: wire.is_public,
    createdAt: wire.created_at,
  };
}

function mapAsset(wire: WireProfileAsset): ProfileAsset {
  return {
    name: wire.name,
    assetLongname: wire.asset_longname,
    issuer: wire.issuer,
    issuerUsername: wire.issuer_username,
    description: wire.description,
    divisible: wire.divisible,
    supply: wire.supply,
    holders: wire.holders,
    imageUrl: wire.image_url,
    imageLargeUrl: wire.image_large_url,
    price: wire.price,
    floorPrice: wire.floor_price,
    btcVolume: wire.btc_volume,
    tradeCount: wire.trade_count,
    collection: wire.collection,
  };
}

function mapAssetPage(wire: WireAssetPage): ProfileAssetPage {
  return {
    assets: (wire.assets ?? []).map(mapAsset),
    pagination: mapPagination(wire.pagination),
  };
}

function mapSwapPage(wire: WireSwapPage): ProfileSwapPage {
  return {
    atomicSwaps: (wire.atomic_swaps ?? []).map(mapAtomicSwap),
    pagination: mapPagination(wire.pagination),
  };
}

function mapPointsSummary(wire: WirePointsSummary): PointsSummary {
  return {
    balance: {
      points: wire.balance.points,
      confirmedTotal: wire.balance.confirmed_total,
      spentTotal: wire.balance.spent_total,
    },
    confirmedTotal: wire.confirmed_total,
    pendingTotal: wire.pending_total,
    pointsMultiplierRemainingMs: wire.points_multiplier_remaining_ms,
    rewardActions: (wire.reward_actions ?? []).map((action) => ({
      id: action.id,
      actionId: action.action_id,
      eventId: action.event_id,
      reward: action.reward,
      status: action.status,
      createdAt: action.created_at,
    })),
    pagination: mapPagination(wire.pagination),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when a username is the random UUID a fresh account is created with —
 * i.e. the user has never picked one. Clients show these as "unset" rather than
 * printing the UUID.
 */
export function isPlaceholderUsername(username: string | null): boolean {
  return username === null || UUID_PATTERN.test(username);
}

function pageQuery(params?: ProfilePageParams): string {
  const qs = new URLSearchParams();
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return query ? `?${query}` : "";
}

// ─── Authenticated: the caller's own profile ─────────────────────────────────

/** GET /api/profiles/me — the signed-in account's profile. */
export async function getMyProfile(
  http: HttpClient,
  options?: RequestOptions,
): Promise<MyProfile> {
  const wire = await http.request<WireMyProfile>(
    "GET",
    "/api/profiles/me",
    undefined,
    options?.signal,
  );
  return mapMyProfile(wire);
}

/**
 * PATCH /api/profiles/me — partial update of username / bio / visibility.
 *
 * Only the supplied keys are written; at least one is required. Setting a real
 * (non-UUID) username **and** `isPublic: true` completes profile setup and grants
 * the one-off `profile-setup` points reward. The avatar is not part of this call
 * — upload it with {@link uploadMyAvatar}.
 *
 * @throws {HorizonMarketApiError} `409` when the username belongs to someone
 * else, `400` when a value fails validation.
 */
export async function updateMyProfile(
  http: HttpClient,
  params: UpdateMyProfileParams,
  options?: RequestOptions,
): Promise<MyProfile> {
  const body: Record<string, unknown> = {};
  if (params.username !== undefined) body.username = params.username;
  if (params.bio !== undefined) body.bio = params.bio;
  if (params.isPublic !== undefined) body.is_public = params.isPublic;

  const wire = await http.request<WireMyProfile>(
    "PATCH",
    "/api/profiles/me",
    body,
    options?.signal,
  );
  return mapMyProfile(wire);
}

/**
 * GET /api/profiles/me/username-availability — can this name be claimed?
 *
 * Case-insensitive. The caller's *own* current username reports as available, so
 * a no-op rename never looks like a conflict; reserved names (`me`) are
 * well-formed but report `available: false`.
 */
export async function checkUsernameAvailability(
  http: HttpClient,
  username: string,
  options?: RequestOptions,
): Promise<UsernameAvailability> {
  const qs = new URLSearchParams({ username });
  return http.request<UsernameAvailability>(
    "GET",
    `/api/profiles/me/username-availability?${qs.toString()}`,
    undefined,
    options?.signal,
  );
}

/**
 * GET /api/profiles/me/avatar — the caller's own avatar as a `data:` URL.
 *
 * That endpoint is auth-gated and served `private, no-store`, so its URL cannot
 * simply be handed to an `<img>`/`<Image>` the way a public avatar URL can. This
 * fetches it with the session credentials and inlines the bytes instead.
 *
 * Returns `null` when no avatar is set.
 */
export async function getMyAvatarDataUrl(
  http: HttpClient,
  options?: RequestOptions,
): Promise<string | null> {
  const response = await http.fetchRaw("GET", "/api/profiles/me/avatar", {
    headers: { Accept: "image/png" },
    signal: options?.signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new HorizonMarketApiError(
      response.status,
      await readErrorMessage(response),
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) return null;
  const contentType = response.headers?.get?.("content-type") || "image/png";
  return `data:${contentType};base64,${base64.encode(bytes)}`;
}

/**
 * PUT /api/profiles/me/avatar — upload an avatar (multipart).
 *
 * Accepts a `Blob`/`File` or a React Native `{ uri, name, type }` picker result.
 * The `Content-Type` header is deliberately left to `fetch`, which fills in the
 * multipart boundary.
 *
 * @throws {HorizonMarketApiError} `400` when the file is missing, over 5 MB,
 * above 25 megapixels, or not a PNG / JPEG / GIF / BMP.
 */
export async function uploadMyAvatar(
  http: HttpClient,
  image: AvatarUpload,
  options?: RequestOptions,
): Promise<AvatarUploadResult> {
  const form = new FormData();
  appendFilePart(form, "image", image, {
    name: "avatar.png",
    type: "image/png",
  });

  const response = await http.fetchRaw("PUT", "/api/profiles/me/avatar", {
    headers: { Accept: "application/json" },
    body: form,
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new HorizonMarketApiError(
      response.status,
      await readErrorMessage(response),
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: { avatar_url?: string };
  } | null;
  const avatarUrl = payload?.data?.avatar_url;
  if (!avatarUrl) {
    throw new HorizonMarketApiError(
      response.status,
      "Avatar upload returned no avatar_url",
    );
  }
  return { avatarUrl };
}

/**
 * GET /api/profiles/me/wallets — wallets linked to the account, newest first.
 *
 * Linking happens through the auth flow, not here; this only reports what is
 * linked and whether each address is public.
 */
export async function listMyWallets(
  http: HttpClient,
  options?: RequestOptions,
): Promise<ProfileWallet[]> {
  const wire = await http.request<{ wallets: WireProfileWallet[] }>(
    "GET",
    "/api/profiles/me/wallets",
    undefined,
    options?.signal,
  );
  return (wire.wallets ?? []).map(mapWallet);
}

/**
 * PATCH /api/profiles/me/wallets/{address} — publish or hide a linked wallet.
 *
 * An idempotent *set*, not a toggle, so a retried request cannot flip the value
 * back. A public address is what makes the profile's listings and curated assets
 * visible.
 *
 * @throws {HorizonMarketApiError} `404` when the address is not linked to the
 * caller.
 */
export async function setWalletVisibility(
  http: HttpClient,
  address: string,
  isPublic: boolean,
  options?: RequestOptions,
): Promise<WalletVisibility> {
  const wire = await http.request<{ address: string; is_public: boolean }>(
    "PATCH",
    `/api/profiles/me/wallets/${encodeURIComponent(address)}`,
    { is_public: isPublic },
    options?.signal,
  );
  return { address: wire.address, isPublic: wire.is_public };
}

/**
 * GET /api/profiles/me/assets — assets issued by any linked wallet, newest
 * issuance first. Public or not; empty when no wallet is linked.
 */
export async function listMyAssets(
  http: HttpClient,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileAssetPage> {
  const wire = await http.request<WireAssetPage>(
    "GET",
    `/api/profiles/me/assets${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapAssetPage(wire);
}

/** GET /api/profiles/me/liked-assets — followed assets, most recent first. */
export async function listMyLikedAssets(
  http: HttpClient,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileAssetPage> {
  const wire = await http.request<WireAssetPage>(
    "GET",
    `/api/profiles/me/liked-assets${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapAssetPage(wire);
}

/**
 * PUT /api/profiles/me/liked-assets/{asset} — follow an asset. Idempotent.
 *
 * `asset` is the Counterparty asset *name* (not a subasset longname): the liked
 * list keys on the name, so a longname is stored but never resolves.
 */
export async function followAsset(
  http: HttpClient,
  asset: string,
  options?: RequestOptions,
): Promise<FollowState> {
  return http.request<FollowState>(
    "PUT",
    `/api/profiles/me/liked-assets/${encodeURIComponent(asset)}`,
    undefined,
    options?.signal,
  );
}

/** DELETE /api/profiles/me/liked-assets/{asset} — unfollow. Idempotent. */
export async function unfollowAsset(
  http: HttpClient,
  asset: string,
  options?: RequestOptions,
): Promise<FollowState> {
  return http.request<FollowState>(
    "DELETE",
    `/api/profiles/me/liked-assets/${encodeURIComponent(asset)}`,
    undefined,
    options?.signal,
  );
}

/**
 * GET /api/profiles/me/points — points balance and reward history.
 *
 * `pagination` applies to `rewardActions` only; the balance and totals always
 * cover the whole account. The default page size here is 20, not 50.
 */
export async function getMyPoints(
  http: HttpClient,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<PointsSummary> {
  const wire = await http.request<WirePointsSummary>(
    "GET",
    `/api/profiles/me/points${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapPointsSummary(wire);
}

// ─── Public: someone else's profile ──────────────────────────────────────────

/**
 * GET /api/profiles/{username} — a public profile, or `null` when there is none.
 *
 * A private profile and an unknown username both answer 404 by design, so `null`
 * carries exactly the information the API is willing to give: nothing public
 * lives under that name.
 */
export async function getPublicProfile(
  http: HttpClient,
  username: string,
  options?: RequestOptions,
): Promise<PublicProfile | null> {
  const response = await http.fetchRaw(
    "GET",
    `/api/profiles/${encodeURIComponent(username)}`,
    { headers: { Accept: "application/json" }, signal: options?.signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new HorizonMarketApiError(
      response.status,
      await readErrorMessage(response),
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: WirePublicProfile;
  } | null;
  if (!payload?.data) {
    throw new HorizonMarketApiError(
      response.status,
      "Response missing required { data } envelope",
    );
  }
  return mapPublicProfile(payload.data);
}

/**
 * Absolute URL of a public profile's avatar (`GET /api/profiles/{username}/avatar`).
 *
 * Public and cacheable, so unlike the caller's own avatar this can be used
 * directly as an image source. Prefer the `avatarUrl` on a fetched
 * {@link PublicProfile}, which is `null` when the profile has no avatar; this
 * helper is for building the URL without a round-trip.
 */
export function publicAvatarUrl(baseUrl: string, username: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/profiles/${encodeURIComponent(username)}/avatar`;
}

/**
 * GET /api/profiles/{username}/curated-assets — the showcase a profile curates.
 * Only entries curated from a still-public wallet are returned.
 */
export async function listPublicCuratedAssets(
  http: HttpClient,
  username: string,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileAssetPage> {
  const wire = await http.request<WireAssetPage>(
    "GET",
    `/api/profiles/${encodeURIComponent(username)}/curated-assets${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapAssetPage(wire);
}

/** GET /api/profiles/{username}/liked-assets — a public profile's liked assets. */
export async function listPublicLikedAssets(
  http: HttpClient,
  username: string,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileAssetPage> {
  const wire = await http.request<WireAssetPage>(
    "GET",
    `/api/profiles/${encodeURIComponent(username)}/liked-assets${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapAssetPage(wire);
}

/**
 * GET /api/profiles/{username}/listings — open, funded listings sold from any of
 * the profile's public addresses. Same swap shape as `client.listSwaps()`.
 */
export async function listPublicProfileListings(
  http: HttpClient,
  username: string,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileSwapPage> {
  const wire = await http.request<WireSwapPage>(
    "GET",
    `/api/profiles/${encodeURIComponent(username)}/listings${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapSwapPage(wire);
}

/**
 * GET /api/profiles/{username}/purchases — filled swaps bought by any of the
 * profile's public addresses.
 */
export async function listPublicProfilePurchases(
  http: HttpClient,
  username: string,
  params?: ProfilePageParams,
  options?: RequestOptions,
): Promise<ProfileSwapPage> {
  const wire = await http.request<WireSwapPage>(
    "GET",
    `/api/profiles/${encodeURIComponent(username)}/purchases${pageQuery(params)}`,
    undefined,
    options?.signal,
  );
  return mapSwapPage(wire);
}
