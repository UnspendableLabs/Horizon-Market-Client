import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  useHorizonMarket,
  generateMnemonic,
  validateMnemonic,
} from "@unspendablelabs/horizon-market-client/react";
import { markFreshLogin } from "../lib/app-lock-events.js";
import { persistMnemonicSession } from "../lib/mnemonic-session.js";
import { trackWalletConnected } from "../lib/analytics/events.js";
import { useSecretClipboard } from "../lib/secret-clipboard.js";
import { ScreenCaptureGuard } from "./ScreenCaptureGuard.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

/**
 * The two alternatives to Web3Auth, offered by ConnectPrompt:
 *   - RestoreWalletForm — enter a 12-word BIP39 recovery phrase;
 *   - NewWalletForm — generate 12 fresh words, back them up, then connect.
 *
 * Both connect through the same seam as Web3Auth, just from a phrase instead of a
 * raw key: force Horizon Wallet (BIP84 + BIP86) derivation so the phrase reaches
 * the same addresses in Horizon Wallet / XVerse, seal it in the keychain for
 * cold-start restore, and hand it to the provider. From there everything downstream
 * (sign-in, credits, gated tabs) is identical to the Web3Auth path.
 */

const WORD_COUNT = 12;

/** Resolve on the next frame, so a just-set state can paint before we continue. */
const paintYield = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Shared connect step for both flows. Returns `{ connect, busy }`: `connect(phrase)`
 * runs the (synchronous, CPU-heavy) HD derivation, and `busy` drives a spinner so
 * the tap doesn't just freeze while it runs.
 */
function useMnemonicConnect() {
  const { initializeWithMnemonic, setDerivationMode } = useHorizonMarket();
  const [busy, setBusy] = useState(false);

  const connect = useCallback(
    async (phrase: string) => {
      setBusy(true);
      // Yield two frames so the spinner actually paints before the synchronous HD
      // derivation (mnemonic→seed PBKDF2 + BIP84/86 key derivation) blocks the JS
      // thread — otherwise the tap freezes with no feedback until it finishes.
      await paintYield();
      await paintYield();
      // The user just performed an interactive connect action → the app-lock
      // counts as satisfied for this session (don't prompt Face ID on top).
      markFreshLogin();
      // Mnemonic wallets are Horizon Wallet HD wallets. Persist that mode for the
      // next cold-start restore, AND derive with it explicitly here so the first
      // pass already lands on the BIP84/BIP86 addresses — the controlled prop only
      // flips on the next render, so without the explicit mode the signer would
      // briefly derive single-key addresses and then re-derive once it settles.
      setDerivationMode("horizon-wallet");
      try {
        initializeWithMnemonic(phrase, "horizon-wallet");
      } catch (err) {
        // Derivation failed → re-enable the form and let the caller surface it.
        setBusy(false);
        throw err;
      }
      // Only tracked once derivation actually succeeded — a thrown derivation
      // above must never be counted as a connect.
      trackWalletConnected("mnemonic");
      // Seal the phrase for a later cold-start restore. Fire-and-forget: a write
      // failure only costs the "stay signed in" convenience, never the connect.
      // Leave `busy` set — once addresses resolve the host swaps this screen out,
      // so the spinner covers the gap rather than flashing back to idle.
      void persistMnemonicSession(phrase).catch((err) => {
        console.error("Failed to persist recovery phrase:", err);
      });
    },
    [initializeWithMnemonic, setDerivationMode],
  );

  return { connect, busy };
}

interface FormProps {
  /** Return to the connect menu. */
  onBack: () => void;
}

/**
 * One recovery-phrase word. A password field: masked when idle, shown in clear only
 * while it has focus (so the user can proof-read the word they're typing).
 */
interface WordFieldProps {
  index: number;
  value: string;
  editable: boolean;
  onChangeText: (text: string) => void;
}

function WordField({ index, value, editable, onChangeText }: WordFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wordCell}>
      <Text style={styles.wordCellIndex}>{index + 1}</Text>
      <TextInput
        value={value}
        editable={editable}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Masked (password) unless focused — the word shows in clear only while
        // the user is editing that field.
        secureTextEntry={!focused}
        style={styles.wordCellInput}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        keyboardType="default"
        selectTextOnFocus
      />
    </View>
  );
}

export function RestoreWalletForm({ onBack }: FormProps) {
  const { connect, busy } = useMnemonicConnect();
  const [words, setWords] = useState<string[]>(() => Array(WORD_COUNT).fill(""));
  const [error, setError] = useState<string | null>(null);

  // Spread a whitespace-separated phrase across the grid from word 1.
  const fill = useCallback((tokens: string[]) => {
    const next: string[] = Array(WORD_COUNT).fill("");
    tokens.slice(0, WORD_COUNT).forEach((w, i) => {
      next[i] = w.toLowerCase();
    });
    setWords(next);
    setError(null);
  }, []);

  const setWordAt = (index: number, text: string) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    // A multi-word value in a single field is a paste of the whole phrase —
    // distribute it across the grid regardless of which field received it, so a
    // paste with focus on any field fills all 12.
    if (tokens.length > 1) {
      fill(tokens);
      Keyboard.dismiss();
      return;
    }
    setWords((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
    if (error) setError(null);
  };

  // Explicit paste — reads the clipboard and fills the whole grid. A reliable
  // fallback to the OS paste menu (which routes through onChangeText above).
  const pasteAll = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      const tokens = text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        fill(tokens);
        Keyboard.dismiss();
      }
    } catch {
      /* ignore clipboard failures */
    }
  };

  const allFilled = words.every((w) => w.trim().length > 0);
  const disabled = !allFilled || busy;

  const submit = async () => {
    // Normalize the way BIP39 wordlists expect: lower-case, single-spaced.
    const normalized = words
      .map((w) => w.trim().toLowerCase())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!validateMnemonic(normalized)) {
      setError(
        "That recovery phrase isn't valid. Check all 12 words and their spelling.",
      );
      return;
    }
    setError(null);
    try {
      await connect(normalized);
    } catch {
      setError("Couldn't connect with that recovery phrase. Please try again.");
    }
  };

  return (
    <View style={styles.root}>
      {/* Each word shows in clear while its field is focused, so over the course of
          typing all 12 a screen recorder would see the whole phrase — block capture
          for the life of the form. */}
      <ScreenCaptureGuard guardKey="restore-seed" />
      <Text style={styles.heading}>Restore wallet</Text>
      <Text style={styles.body}>
        Enter your 12-word recovery phrase, or tap Paste to fill all 12 at once.
        Each word stays hidden until you tap its field.
      </Text>

      <View style={styles.inputGrid}>
        {words.map((w, i) => (
          <WordField
            key={i}
            index={i}
            value={w}
            editable={!busy}
            onChangeText={(t) => setWordAt(i, t)}
          />
        ))}
      </View>

      <Pressable
        onPress={() => void pasteAll()}
        disabled={busy}
        style={styles.pasteButton}
        accessibilityRole="button"
      >
        <Text style={styles.pasteButtonText}>Paste</Text>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={() => void submit()}
        disabled={disabled}
        style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Restore wallet</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onBack}
        disabled={busy}
        style={styles.backButton}
        accessibilityRole="button"
      >
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

export function NewWalletForm({ onBack }: FormProps) {
  const { connect, busy } = useMnemonicConnect();
  const copySecret = useSecretClipboard();
  // Generate once — a re-render must not mint a different phrase under the user.
  const phrase = useMemo(() => generateMnemonic(128), []); // 128 bits → 12 words
  const words = useMemo(() => phrase.split(" "), [phrase]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // Auto-wipes from the clipboard after a minute (see useSecretClipboard).
      await copySecret(phrase);
      setCopied(true);
    } catch {
      /* ignore clipboard failures */
    }
  };

  const disabled = !savedConfirmed || busy;

  return (
    <View style={styles.root}>
      {/* The fresh phrase is on screen for its whole life here — block
          screenshots / screen recording / the recents snapshot the whole time. */}
      <ScreenCaptureGuard guardKey="new-wallet-seed" />
      <Text style={styles.heading}>New HD wallet</Text>
      <Text style={styles.body}>
        Write down these 12 words in order and keep them somewhere safe. They are
        the only way to recover this wallet.
      </Text>

      <View style={styles.wordGrid}>
        {words.map((w, i) => (
          <View key={`${i}-${w}`} style={styles.wordChip}>
            <Text style={styles.wordIndex}>{i + 1}</Text>
            <Text style={styles.wordText}>{w}</Text>
          </View>
        ))}
      </View>

      <Pressable onPress={() => void copy()} style={styles.copyButton} accessibilityRole="button">
        <Text style={styles.copyButtonText}>{copied ? "Copied ✓" : "Copy"}</Text>
      </Pressable>
      {copied && (
        <Text style={styles.hint}>Cleared from the clipboard after a minute.</Text>
      )}

      <Text style={styles.warning}>
        Anyone with this phrase controls the funds on this wallet. Never share it.
        Store it offline.
      </Text>

      <View style={styles.confirmRow}>
        <Switch
          value={savedConfirmed}
          onValueChange={setSavedConfirmed}
          disabled={busy}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.foreground}
        />
        <Text style={styles.confirmText}>I've saved my recovery phrase.</Text>
      </View>

      <Pressable
        onPress={() => void connect(phrase)}
        disabled={disabled}
        style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Create wallet</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onBack}
        disabled={busy}
        style={styles.backButton}
        accessibilityRole="button"
      >
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  heading: {
    fontSize: 17,
    color: colors.foreground,
    fontFamily: fonts.sansBold,
  },
  body: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 19,
  },
  error: {
    fontSize: 12,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },

  /* Restore: 12-field masked input grid (2 columns) */
  inputGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  wordCell: {
    flexGrow: 1,
    flexBasis: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  wordCellIndex: {
    width: 18,
    textAlign: "right",
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.mono,
  },
  wordCellInput: {
    flex: 1,
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.mono,
    paddingVertical: 4,
  },
  pasteButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pasteButtonText: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },

  /* New wallet: read-only word display grid */
  wordGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  wordChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wordIndex: { fontSize: 12, color: colors.muted, fontFamily: fonts.mono },
  wordText: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  copyButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  copyButtonText: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },
  warning: {
    fontSize: 12,
    color: colors.error,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
    lineHeight: 18,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  confirmText: {
    flex: 1,
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sans,
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: {
    fontSize: 15,
    color: colors.primaryForeground,
    fontFamily: fonts.sansSemiBold,
  },
  backButton: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  backButtonText: {
    fontSize: 14,
    color: colors.muted,
    fontFamily: fonts.sansSemiBold,
  },
});
