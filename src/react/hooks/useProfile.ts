import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type {
  AvatarUpload,
  MyProfile,
  ProfileWallet,
  UpdateMyProfileParams,
} from "../../api/profiles.js";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseProfileResult {
  /** The signed-in account's profile, or `null` before it loads / signed out. */
  profile: MyProfile | null;
  /** True while the first read is in flight. */
  loading: boolean;
  /** Last read error, or `null`. */
  error: string | null;
  /** Re-read the profile (and its avatar) from the server. */
  refresh: () => void;
  /**
   * The account's own avatar inlined as a `data:` URL — that endpoint is
   * auth-gated, so its URL cannot be handed straight to an image element.
   * `null` when none is set.
   */
  avatarDataUrl: string | null;
  /** True while the avatar bytes are being fetched. */
  avatarLoading: boolean;
  /**
   * Save username / bio / visibility. Resolves to the updated profile, or `null`
   * when the server refused — the reason lands in {@link saveError} rather than
   * throwing, since every caller of this is a form.
   */
  save: (params: UpdateMyProfileParams) => Promise<MyProfile | null>;
  saving: boolean;
  /** Why the last {@link save} failed (e.g. "Username already taken"). */
  saveError: string | null;
  /** True for a moment after a successful {@link save} — for a "Saved" hint. */
  saved: boolean;
  /**
   * Whether a username can be claimed. `null` when the check itself failed.
   * The caller's own current name reports as available, so a no-op rename is
   * not a conflict. Debounce at the call site.
   */
  checkUsername: (username: string) => Promise<boolean | null>;
  /**
   * Upload a new avatar (a `Blob`/`File`, or a React Native `{ uri }` picker
   * result). Resolves `true` on success; the reason for a refusal — too large,
   * wrong format — lands in {@link avatarError}.
   */
  uploadAvatar: (image: AvatarUpload) => Promise<boolean>;
  uploadingAvatar: boolean;
  avatarError: string | null;
}

/**
 * The signed-in account's Horizon Market profile: read it, edit username / bio /
 * visibility, and replace the avatar.
 *
 * Everything here is session-gated (`/api/profiles/me/*`), so it stays idle
 * until the provider's wallet sign-in lands — `isAuthenticated`. Signing out
 * clears the state rather than leaving a stale profile on screen.
 *
 * The avatar is fetched separately and exposed as a `data:` URL: the caller's
 * own avatar endpoint requires the session and is served `no-store`, so unlike a
 * public profile's avatar its URL cannot be used as an image source directly.
 */
export function useProfile(): UseProfileResult {
  const { client, isAuthenticated } = useHorizonMarket();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Monotonic guard: a slower earlier read must never overwrite a newer one
  // (sign-out → sign-in, or a refresh racing the initial load).
  const seqRef = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const seq = ++seqRef.current;

    if (!isAuthenticated) {
      setProfile(null);
      setAvatarDataUrl(null);
      setError(null);
      setLoading(false);
      setAvatarLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    client
      .getMyProfile()
      .then((next) => {
        if (seq !== seqRef.current) return;
        setProfile(next);
        setLoading(false);

        if (!next.avatarUrl) {
          setAvatarDataUrl(null);
          return;
        }
        setAvatarLoading(true);
        return client
          .getMyAvatarDataUrl()
          .then((dataUrl) => {
            if (seq !== seqRef.current) return;
            setAvatarDataUrl(dataUrl);
            setAvatarLoading(false);
          })
          .catch(() => {
            // A missing/broken avatar must not read as "the profile failed to
            // load" — drop the image and keep the profile.
            if (seq !== seqRef.current) return;
            setAvatarDataUrl(null);
            setAvatarLoading(false);
          });
      })
      .catch((err) => {
        if (seq !== seqRef.current) return;
        setError(message(err));
        setLoading(false);
      });
  }, [client, isAuthenticated, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const save = useCallback(
    async (params: UpdateMyProfileParams): Promise<MyProfile | null> => {
      setSaving(true);
      setSaveError(null);
      setSaved(false);
      try {
        const updated = await client.updateMyProfile(params);
        setProfile(updated);
        setSaved(true);
        return updated;
      } catch (err) {
        setSaveError(message(err));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [client],
  );

  const checkUsername = useCallback(
    async (username: string): Promise<boolean | null> => {
      try {
        const { available } = await client.checkUsernameAvailability(username);
        return available;
      } catch {
        return null;
      }
    },
    [client],
  );

  const uploadAvatar = useCallback(
    async (image: AvatarUpload): Promise<boolean> => {
      setUploadingAvatar(true);
      setAvatarError(null);
      try {
        const { avatarUrl } = await client.uploadMyAvatar(image);
        // The URL is stable across uploads (it names the endpoint, not the
        // image), so re-read the bytes to actually repaint the new picture.
        setProfile((prev) => (prev ? { ...prev, avatarUrl } : prev));
        setAvatarLoading(true);
        const dataUrl = await client.getMyAvatarDataUrl().catch(() => null);
        setAvatarDataUrl(dataUrl);
        setAvatarLoading(false);
        return true;
      } catch (err) {
        setAvatarError(message(err));
        return false;
      } finally {
        setUploadingAvatar(false);
      }
    },
    [client],
  );

  return {
    profile,
    loading,
    error,
    refresh,
    avatarDataUrl,
    avatarLoading,
    save,
    saving,
    saveError,
    saved,
    checkUsername,
    uploadAvatar,
    uploadingAvatar,
    avatarError,
  };
}

export interface UseProfileWalletsResult {
  /** Wallets linked to the account, newest first. */
  wallets: ProfileWallet[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * Publish or hide one linked wallet — an idempotent set, not a toggle. Only a
   * public address's listings and curated assets appear on the public profile.
   * Resolves `false` when the server refused (reason in {@link error}).
   */
  setVisibility: (address: string, isPublic: boolean) => Promise<boolean>;
  /** The address currently being updated, or `null`. */
  updating: string | null;
}

/**
 * The wallets linked to the signed-in account, and which of them are public.
 *
 * Linking happens through the auth flow (signing in with a wallet links it), so
 * this only reports what is linked and flips each address's visibility.
 */
export function useProfileWallets(): UseProfileWalletsResult {
  const { client, isAuthenticated } = useHorizonMarket();

  const [wallets, setWallets] = useState<ProfileWallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const seqRef = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const seq = ++seqRef.current;

    if (!isAuthenticated) {
      setWallets([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    client
      .listMyWallets()
      .then((next) => {
        if (seq !== seqRef.current) return;
        setWallets(next);
        setLoading(false);
      })
      .catch((err) => {
        if (seq !== seqRef.current) return;
        setError(message(err));
        setLoading(false);
      });
  }, [client, isAuthenticated, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const setVisibility = useCallback(
    async (address: string, isPublic: boolean): Promise<boolean> => {
      setUpdating(address);
      setError(null);
      try {
        const result = await client.setWalletVisibility(address, isPublic);
        setWallets((prev) =>
          prev.map((wallet) =>
            wallet.address === result.address
              ? { ...wallet, isPublic: result.isPublic }
              : wallet,
          ),
        );
        return true;
      } catch (err) {
        setError(message(err));
        return false;
      } finally {
        setUpdating(null);
      }
    },
    [client],
  );

  return { wallets, loading, error, refresh, setVisibility, updating };
}
