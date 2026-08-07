import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  isPlaceholderUsername,
  useHorizonMarket,
  useProfile,
  useProfileWallets,
} from "@unspendablelabs/horizon-market-client/react";
import { ConnectPrompt } from "../components/ConnectPrompt.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";
import {
  trackProfileAvatarChanged,
  trackProfileSaved,
  trackProfileWalletVisibilityChanged,
} from "../lib/analytics/events.js";

/** Same shape the API enforces: 1–30 lowercase letters, digits, `_`, `-`, `,`. */
const USERNAME_PATTERN = /^[a-z0-9_,-]{1,30}$/;
const BIO_MAX = 500;

type UsernameCheck =
  | { state: "idle" | "checking" | "available" | "taken" }
  | { state: "invalid"; reason: string };

function shortAddress(address: string): string {
  return address.length > 18
    ? `${address.slice(0, 10)}…${address.slice(-6)}`
    : address;
}

/**
 * Profile screen — reached from the user icon in the {@link Header}, not from a
 * tab: it is a root-stack route that pushes over the tab pager and pops back.
 *
 * Everything it reads is session-gated (`/api/profiles/me/*`), so it needs BOTH
 * a connected wallet and the Horizon Market session the provider mints from it.
 * No wallet → the same {@link ConnectPrompt} login gate the Sell / Wallet tabs
 * show. Wallet but no session yet → a "signing in" notice, since the profile
 * simply is not readable until that lands.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { addresses } = useHorizonMarket();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))}
          style={styles.back}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Profile</Text>
      </View>

      {addresses ? (
        <ProfileEditor />
      ) : (
        <ConnectPrompt message="Connect your wallet to manage your Horizon Market profile." />
      )}
    </ScrollView>
  );
}

function ProfileEditor() {
  const { isAuthenticated, signInError } = useHorizonMarket();
  const {
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
  } = useProfile();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [check, setCheck] = useState<UsernameCheck>({ state: "idle" });
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Seed the form from whatever the server last told us. `profile` is a new
  // object on every load and after every save, so this re-syncs on a refresh and
  // adopts the server's normalised values (trimmed bio, lowercased username)
  // instead of leaving the user's raw input on screen.
  useEffect(() => {
    if (!profile) return;
    setUsername(isPlaceholderUsername(profile.username) ? "" : (profile.username ?? ""));
    setBio(profile.bio ?? "");
    setIsPublic(profile.isPublic);
    setCheck({ state: "idle" });
  }, [profile]);

  // Debounced availability check. Skipped for the current name (a no-op rename
  // is not a conflict) and for anything the API would reject outright.
  const currentUsername = isPlaceholderUsername(profile?.username ?? null)
    ? ""
    : (profile?.username ?? "");
  useEffect(() => {
    const value = username.trim();
    if (value === "" || value === currentUsername) {
      setCheck({ state: "idle" });
      return;
    }
    if (!USERNAME_PATTERN.test(value)) {
      setCheck({
        state: "invalid",
        reason:
          value.length > 30
            ? "30 characters max."
            : "Lowercase letters, digits, _ - and , only.",
      });
      return;
    }

    setCheck({ state: "checking" });
    let active = true;
    const timer = setTimeout(() => {
      void checkUsername(value).then((available) => {
        if (!active) return;
        // `null` = the check itself failed; stay quiet rather than claim the
        // name is taken — the save call is the real arbiter either way.
        if (available === null) setCheck({ state: "idle" });
        else setCheck({ state: available ? "available" : "taken" });
      });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username, currentUsername, checkUsername]);

  const pickAvatar = async () => {
    setPickerError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickerError("Photo access is needed to choose a picture.");
      return;
    }
    // Square crop up front: the server re-encodes to a 512×512 PNG regardless,
    // so cropping here is what keeps the user's framing.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    const ok = await uploadAvatar({
      uri: asset.uri,
      name: asset.fileName ?? "avatar.jpg",
      type: asset.mimeType ?? "image/jpeg",
    });
    if (ok) trackProfileAvatarChanged();
  };

  const trimmedUsername = username.trim();
  const trimmedBio = bio.trim();
  // Clearing the field is not a rename — the API has no way to unset a username
  // (an account always has one), so an empty box just means "leave it alone".
  const usernameChanged =
    trimmedUsername !== "" && trimmedUsername !== currentUsername;
  const dirty =
    profile !== null &&
    (usernameChanged ||
      trimmedBio !== (profile.bio ?? "") ||
      isPublic !== profile.isPublic);
  const blocked = check.state === "taken" || check.state === "invalid";

  const handleSave = async () => {
    if (!profile) return;
    // Send only what changed — the API is a partial update, and re-sending an
    // unchanged username would burn the availability race for no reason.
    const params: Parameters<typeof save>[0] = {};
    if (usernameChanged) params.username = trimmedUsername;
    if (trimmedBio !== (profile.bio ?? "")) params.bio = trimmedBio;
    if (isPublic !== profile.isPublic) params.isPublic = isPublic;
    if (Object.keys(params).length === 0) return;

    const updated = await save(params);
    if (updated) {
      trackProfileSaved({
        renamed: params.username !== undefined,
        isPublic: updated.isPublic,
      });
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.notice}>
        {signInError ? (
          <>
            <Text style={styles.noticeTitle}>Sign-in failed</Text>
            <Text style={styles.noticeText}>{signInError}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.noticeText}>
              Signing in to Horizon Market with your wallet…
            </Text>
          </>
        )}
      </View>
    );
  }

  if (loading && !profile) {
    return (
      <View style={styles.notice}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={styles.notice}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={refresh} style={styles.secondaryButton} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!profile) return null;

  const initial = (trimmedUsername || profile.username || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <View style={styles.sections}>
      {/* Avatar */}
      <View style={styles.avatarBlock}>
        <View style={styles.avatar}>
          {avatarDataUrl ? (
            <Image source={{ uri: avatarDataUrl }} style={styles.avatarImage} />
          ) : avatarLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </View>
        <Pressable
          onPress={() => void pickAvatar()}
          disabled={uploadingAvatar}
          style={[styles.secondaryButton, uploadingAvatar && styles.buttonDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>
            {uploadingAvatar
              ? "Uploading…"
              : avatarDataUrl
                ? "Change photo"
                : "Add a photo"}
          </Text>
        </Pressable>
        {(avatarError || pickerError) && (
          <Text style={styles.errorText}>{avatarError ?? pickerError}</Text>
        )}
      </View>

      {/* Username / bio / visibility */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Public identity</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="pick-a-username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            style={styles.input}
          />
          <Text
            style={[
              styles.fieldHint,
              check.state === "taken" || check.state === "invalid"
                ? styles.fieldHintError
                : check.state === "available" && styles.fieldHintOk,
            ]}
          >
            {check.state === "checking"
              ? "Checking availability…"
              : check.state === "available"
                ? "Available"
                : check.state === "taken"
                  ? "Already taken"
                  : check.state === "invalid"
                    ? check.reason
                    : "Your profile lives at horizon.market/profile/<username>."}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Tell collectors who you are"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={BIO_MAX}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.fieldHint}>
            {bio.length}/{BIO_MAX}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Public profile</Text>
              <Text style={styles.switchSub}>
                Anyone can view your profile, your listings and your curated
                assets. Off, it is visible to you only.
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.foreground}
            />
          </View>
        </View>

        <Pressable
          onPress={() => void handleSave()}
          disabled={!dirty || saving || blocked}
          style={[
            styles.primaryButton,
            (!dirty || saving || blocked) && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {saving ? "Saving…" : "Save changes"}
          </Text>
        </Pressable>
        {saveError && <Text style={styles.errorText}>{saveError}</Text>}
        {saved && !dirty && !saveError && (
          <Text style={styles.successText}>Profile saved.</Text>
        )}
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <Row label="Points" value={String(profile.pointsBalance)} />
          <View style={styles.divider} />
          <Row
            label="Credits"
            value={String(profile.credits + profile.freeCredits)}
          />
          <View style={styles.divider} />
          <Row label="Email" value={profile.email ?? "Not linked"} />
          <View style={styles.divider} />
          {/* X linking is a web-only OAuth flow, so this is read-only here. */}
          <Row
            label="X (Twitter)"
            value={profile.xUsername ? `@${profile.xUsername}` : "Not linked"}
          />
        </View>
      </View>

      <WalletsSection />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Linked wallets and which of them are public. Linking happens by signing in
 * with a wallet, so this only flips visibility — and only a public address's
 * listings and curated assets show up on the public profile.
 */
function WalletsSection() {
  const { wallets, loading, error, setVisibility, updating } =
    useProfileWallets();

  if (loading && wallets.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Linked wallets</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {wallets.length === 0 ? (
        <Text style={styles.fieldHint}>No wallet linked to this account yet.</Text>
      ) : (
        <View style={styles.card}>
          {wallets.map((wallet, index) => (
            <View key={wallet.address}>
              {index > 0 && <View style={styles.divider} />}
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.mono}>{shortAddress(wallet.address)}</Text>
                  <Text style={styles.switchSub}>
                    {wallet.isPublic
                      ? "Listings from this address are public."
                      : "Hidden from your public profile."}
                  </Text>
                </View>
                <Switch
                  value={wallet.isPublic}
                  disabled={updating === wallet.address}
                  onValueChange={(next) => {
                    void setVisibility(wallet.address, next).then((ok) => {
                      if (ok) trackProfileWalletVisibilityChanged(next);
                    });
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.foreground}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  back: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    fontSize: 28,
    lineHeight: 32,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },

  sections: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  avatarBlock: {
    alignItems: "center",
    gap: spacing.sm,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitial: {
    fontSize: 36,
    color: colors.mutedStrong,
    fontFamily: fonts.sansBold,
  },

  field: { gap: spacing.xs },
  fieldLabel: {
    fontSize: 13,
    color: colors.mutedStrong,
    fontFamily: fonts.sansSemiBold,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },
  fieldHintOk: { color: colors.success },
  fieldHintError: { color: colors.error },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  textarea: {
    minHeight: 96,
    textAlignVertical: "top",
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  mono: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.mono,
  },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  switchText: { flex: 1, gap: 2 },
  switchTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  switchSub: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 17,
  },

  primaryButton: {
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontSize: 15,
    color: colors.primaryForeground,
    fontFamily: fonts.sansBold,
  },
  secondaryButton: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  buttonDisabled: { opacity: 0.5 },

  notice: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  noticeTitle: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  noticeText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
    lineHeight: 19,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
  successText: {
    fontSize: 13,
    color: colors.success,
    fontFamily: fonts.sans,
  },
});
