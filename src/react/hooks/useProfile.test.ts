// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { useProfile, useProfileWallets } from "./useProfile.js";
import type { MyProfile, ProfileWallet } from "../../api/profiles.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const PROFILE: MyProfile = {
  username: "alice",
  bio: "gm",
  isPublic: true,
  xUsername: null,
  avatarUrl: "https://horizon.market/api/profiles/me/avatar",
  email: null,
  hasEmail: false,
  credits: 2,
  freeCredits: 5,
  pointsBalance: 300,
};

const WALLET: ProfileWallet = {
  address: "bc1qwallet",
  walletProvider: "horizon-market-client",
  taprootAddress: "bc1pwallet",
  isPublic: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function profileClient(overrides: Record<string, unknown> = {}) {
  return {
    getMyProfile: vi.fn(async () => PROFILE),
    getMyAvatarDataUrl: vi.fn(async () => "data:image/png;base64,AAA"),
    updateMyProfile: vi.fn(async () => PROFILE),
    checkUsernameAvailability: vi.fn(async (username: string) => ({
      username,
      available: true,
    })),
    uploadMyAvatar: vi.fn(async () => ({
      avatarUrl: "https://horizon.market/api/profiles/me/avatar",
    })),
    ...overrides,
  };
}

describe("useProfile", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx({ client: profileClient() });
  });

  it("loads the profile and its avatar once signed in", async () => {
    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    expect(result.current.loading).toBe(false);
    await waitFor(() =>
      expect(result.current.avatarDataUrl).toBe("data:image/png;base64,AAA"),
    );
    expect(result.current.avatarLoading).toBe(false);
  });

  it("stays idle while the wallet sign-in has not landed", async () => {
    const client = profileClient();
    ctxRef.current = makeCtx({ client, isAuthenticated: false });

    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getMyProfile).not.toHaveBeenCalled();
    expect(result.current.profile).toBeNull();
  });

  it("clears the profile when the session goes away", async () => {
    const { result, rerender } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));

    ctxRef.current = makeCtx({
      client: profileClient(),
      isAuthenticated: false,
    });
    rerender();

    await waitFor(() => expect(result.current.profile).toBeNull());
    expect(result.current.avatarDataUrl).toBeNull();
  });

  it("skips the avatar fetch when the profile has none", async () => {
    const client = profileClient({
      getMyProfile: vi.fn(async () => ({ ...PROFILE, avatarUrl: null })),
    });
    ctxRef.current = makeCtx({ client });

    const { result } = renderHook(() => useProfile());

    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(client.getMyAvatarDataUrl).not.toHaveBeenCalled();
    expect(result.current.avatarDataUrl).toBeNull();
  });

  it("keeps the profile when only the avatar fetch fails", async () => {
    const client = profileClient({
      getMyAvatarDataUrl: vi.fn(async () => {
        throw new Error("HTTP 500");
      }),
    });
    ctxRef.current = makeCtx({ client });

    const { result } = renderHook(() => useProfile());

    // Wait for the avatar attempt itself — `avatarLoading` is false both before
    // it starts and after it fails, so waiting on that alone can pass early.
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    await waitFor(() => expect(client.getMyAvatarDataUrl).toHaveBeenCalled());
    await waitFor(() => expect(result.current.avatarLoading).toBe(false));
    expect(result.current.avatarDataUrl).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a read failure", async () => {
    ctxRef.current = makeCtx({
      client: profileClient({
        getMyProfile: vi.fn(async () => {
          throw new Error("HTTP 401: Unauthorized");
        }),
      }),
    });

    const { result } = renderHook(() => useProfile());

    await waitFor(() =>
      expect(result.current.error).toBe("HTTP 401: Unauthorized"),
    );
    expect(result.current.loading).toBe(false);
  });

  it("re-reads on refresh()", async () => {
    const client = profileClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(client.getMyProfile).toHaveBeenCalledTimes(1));

    act(() => result.current.refresh());

    await waitFor(() => expect(client.getMyProfile).toHaveBeenCalledTimes(2));
  });

  it("saves an edit and adopts the server's version of the profile", async () => {
    const updated = { ...PROFILE, username: "bob", bio: "hi" };
    const client = profileClient({
      updateMyProfile: vi.fn(async () => updated),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));

    let saved: MyProfile | null = null;
    await act(async () => {
      saved = await result.current.save({ username: "bob", bio: "hi" });
    });

    expect(client.updateMyProfile).toHaveBeenCalledWith({
      username: "bob",
      bio: "hi",
    });
    expect(saved).toEqual(updated);
    expect(result.current.profile).toEqual(updated);
    expect(result.current.saved).toBe(true);
    expect(result.current.saveError).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("reports a rejected save instead of throwing at the form", async () => {
    const client = profileClient({
      updateMyProfile: vi.fn(async () => {
        throw new Error("HTTP 409: Username already taken");
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());

    let saved: MyProfile | null = PROFILE;
    await act(async () => {
      saved = await result.current.save({ username: "taken" });
    });

    expect(saved).toBeNull();
    expect(result.current.saveError).toBe("HTTP 409: Username already taken");
    expect(result.current.saved).toBe(false);
    expect(result.current.profile).toEqual(PROFILE);
  });

  it("answers the availability check, and null when it fails", async () => {
    const client = profileClient({
      checkUsernameAvailability: vi
        .fn()
        .mockResolvedValueOnce({ username: "free", available: true })
        .mockRejectedValueOnce(new Error("HTTP 500")),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());

    await expect(result.current.checkUsername("free")).resolves.toBe(true);
    await expect(result.current.checkUsername("boom")).resolves.toBeNull();
  });

  it("re-reads the avatar bytes after an upload (the URL never changes)", async () => {
    const client = profileClient({
      getMyProfile: vi.fn(async () => ({ ...PROFILE, avatarUrl: null })),
      getMyAvatarDataUrl: vi.fn(async () => "data:image/png;base64,NEW"),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    let ok = false;
    await act(async () => {
      ok = await result.current.uploadAvatar({ uri: "file:///tmp/pic.jpg" });
    });

    expect(ok).toBe(true);
    expect(client.uploadMyAvatar).toHaveBeenCalledWith({
      uri: "file:///tmp/pic.jpg",
    });
    expect(result.current.avatarDataUrl).toBe("data:image/png;base64,NEW");
    expect(result.current.profile?.avatarUrl).toBe(
      "https://horizon.market/api/profiles/me/avatar",
    );
    expect(result.current.avatarError).toBeNull();
    expect(result.current.uploadingAvatar).toBe(false);
  });

  it("surfaces a refused upload", async () => {
    const client = profileClient({
      uploadMyAvatar: vi.fn(async () => {
        throw new Error("HTTP 400: Image size must be less than 5MB");
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());

    let ok = true;
    await act(async () => {
      ok = await result.current.uploadAvatar({ uri: "file:///tmp/big.jpg" });
    });

    expect(ok).toBe(false);
    expect(result.current.avatarError).toBe(
      "HTTP 400: Image size must be less than 5MB",
    );
  });

  it("drops the avatar when the post-upload re-read fails", async () => {
    const client = profileClient({
      getMyProfile: vi.fn(async () => ({ ...PROFILE, avatarUrl: null })),
      getMyAvatarDataUrl: vi.fn(async () => {
        throw new Error("HTTP 500");
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());

    await act(async () => {
      await result.current.uploadAvatar({ uri: "file:///tmp/pic.jpg" });
    });

    expect(result.current.avatarDataUrl).toBeNull();
    expect(result.current.avatarLoading).toBe(false);
  });
});

describe("useProfileWallets", () => {
  function walletClient(overrides: Record<string, unknown> = {}) {
    return {
      listMyWallets: vi.fn(async () => [WALLET]),
      setWalletVisibility: vi.fn(async (address: string, isPublic: boolean) => ({
        address,
        isPublic,
      })),
      ...overrides,
    };
  }

  beforeEach(() => {
    ctxRef.current = makeCtx({ client: walletClient() });
  });

  it("lists the linked wallets", async () => {
    const { result } = renderHook(() => useProfileWallets());

    await waitFor(() => expect(result.current.wallets).toEqual([WALLET]));
    expect(result.current.loading).toBe(false);
  });

  it("stays idle when signed out", async () => {
    const client = walletClient();
    ctxRef.current = makeCtx({ client, isAuthenticated: false });

    const { result } = renderHook(() => useProfileWallets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.listMyWallets).not.toHaveBeenCalled();
    expect(result.current.wallets).toEqual([]);
  });

  it("surfaces a read failure", async () => {
    ctxRef.current = makeCtx({
      client: walletClient({
        listMyWallets: vi.fn(async () => {
          throw new Error("HTTP 500: boom");
        }),
      }),
    });

    const { result } = renderHook(() => useProfileWallets());

    await waitFor(() => expect(result.current.error).toBe("HTTP 500: boom"));
  });

  it("re-lists on refresh()", async () => {
    const client = walletClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfileWallets());
    await waitFor(() => expect(client.listMyWallets).toHaveBeenCalledTimes(1));

    act(() => result.current.refresh());

    await waitFor(() => expect(client.listMyWallets).toHaveBeenCalledTimes(2));
  });

  it("applies the server's new visibility to the listed wallet", async () => {
    const client = walletClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfileWallets());
    await waitFor(() => expect(result.current.wallets).toHaveLength(1));

    let ok = false;
    await act(async () => {
      ok = await result.current.setVisibility("bc1qwallet", true);
    });

    expect(ok).toBe(true);
    expect(client.setWalletVisibility).toHaveBeenCalledWith("bc1qwallet", true);
    expect(result.current.wallets[0].isPublic).toBe(true);
    expect(result.current.updating).toBeNull();
  });

  it("leaves the row untouched when the update is refused", async () => {
    const client = walletClient({
      setWalletVisibility: vi.fn(async () => {
        throw new Error("HTTP 404: Wallet not found");
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useProfileWallets());
    await waitFor(() => expect(result.current.wallets).toHaveLength(1));

    let ok = true;
    await act(async () => {
      ok = await result.current.setVisibility("bc1qwallet", true);
    });

    expect(ok).toBe(false);
    expect(result.current.wallets[0].isPublic).toBe(false);
    expect(result.current.error).toBe("HTTP 404: Wallet not found");
  });
});
