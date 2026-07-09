/**
 * App-lock gate — the biometric / device-passcode screen that covers the whole
 * app whenever a wallet session is active (mirrors Kraken's app lock).
 *
 * Design (see the product decisions this was built to):
 *   - Scope: only locks when a wallet is connected. Browsing the public market
 *     with no wallet is never gated (nothing sensitive is shown).
 *   - Cold start: the moment a restored/created session produces addresses, the
 *     app is locked until the OS auth succeeds.
 *   - Background: re-locks after a ~30s grace period in the background, so a quick
 *     app-switch (glance at a notification) doesn't force a re-scan.
 *   - Fallback: biometrics first, device passcode as the escape hatch (handled in
 *     lib/app-lock.ts).
 *
 * ── Why the state lives OUT here (not inside HorizonMarketProvider) ───────────
 * The provider is remounted (`key={network}`) on every network switch, which
 * would reset any lock state held inside it and force a spurious re-auth. So this
 * provider sits ABOVE it and survives the remount; a tiny <AppLockBridge/> mounted
 * *inside* the provider reports whether a wallet is connected back up to here.
 * `locked` is therefore only ever raised by a cold start or the background grace —
 * never by the transient "addresses briefly undefined" gap during a remount.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { authenticate, canUseAppLock } from "../lib/app-lock.js";
import { onFreshLogin } from "../lib/app-lock-events.js";
import { hasPersistedSession } from "../lib/web3auth.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

/** How long the app may sit in the background before it re-locks on return. */
const GRACE_MS = 30_000;

// The brand mark — the SAME asset the native splash shows (app.json → expo-splash-
// screen). The boot cover renders it so the splash → cover → lock handoff is a
// seamless "loading" screen, never a flash of the market underneath.
const brandLogo = require("../assets/icon.png");

interface AppLockContextValue {
  /** Reported by <AppLockBridge/> inside the provider: is a wallet session live? */
  setWalletConnected: (connected: boolean) => void;
  /** Reported by SessionRestorer: the initial probe settled with no wallet. */
  reportNoSession: () => void;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within <AppLockProvider>");
  return ctx;
}

/**
 * Reports — from inside the provider (SessionRestorer) — that the initial session
 * probe finished WITHOUT a wallet (none persisted, an expired one, or an error).
 * That lifts the boot cover so the market can show. When a wallet IS restored the
 * cover is instead lifted by `walletConnected`, handing straight off to the lock,
 * so the market never flashes before the PIN prompt.
 */
export function useAppLockBoot(): () => void {
  return useAppLock().reportNoSession;
}

/**
 * Mounted INSIDE HorizonMarketProvider — reads the SDK's `addresses` and reports
 * wallet presence up to the (outer) AppLockProvider. Renders nothing.
 */
export function AppLockBridge() {
  const { addresses } = useHorizonMarket();
  const { setWalletConnected } = useAppLock();
  useEffect(() => {
    setWalletConnected(!!addresses);
  }, [addresses, setWalletConnected]);
  return null;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [walletConnected, setWalletConnected] = useState(false);
  // `null` while we probe the device; `false` disables the gate entirely (no
  // biometrics and no passcode configured — nothing to authenticate against).
  const [supported, setSupported] = useState<boolean | null>(null);
  // Start locked: a session restored at cold start must pass the gate first.
  const [locked, setLocked] = useState(true);
  const [authing, setAuthing] = useState(false);
  // Boot gate: false until we KNOW the session status. While false we show a
  // neutral cover instead of the market, so a session that's still restoring never
  // flashes the content and then slams the PIN prompt over it. Once set it never
  // resets — a network switch remounts the provider (addresses briefly undefined)
  // and must not re-raise the cover.
  const [bootSettled, setBootSettled] = useState(false);

  // Ref mirror of `authing` for a synchronous re-entrancy guard (state is async).
  const authingRef = useRef(false);
  // Timestamp captured when the app last went to the background (null otherwise).
  const backgroundedAtRef = useRef<number | null>(null);

  // Probe once whether the device can gate at all.
  useEffect(() => {
    let active = true;
    canUseAppLock().then((ok) => {
      if (active) setSupported(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fast path for the boot cover: with no persisted session there is nothing to
  // restore, so lift the cover immediately rather than waiting several seconds on
  // Web3Auth's lazy init. A restored session lifts it via `walletConnected` below;
  // an expired/failed restore lifts it via `reportNoSession`.
  useEffect(() => {
    let active = true;
    hasPersistedSession().then((has) => {
      if (active && !has) setBootSettled(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // A restored session (addresses arrived → walletConnected) settles the boot gate,
  // handing straight off from the cover to the lock with no content in between.
  useEffect(() => {
    if (walletConnected) setBootSettled(true);
  }, [walletConnected]);

  const runAuth = useCallback(async () => {
    if (authingRef.current) return;
    authingRef.current = true;
    setAuthing(true);
    try {
      const ok = await authenticate();
      if (ok) setLocked(false);
      // On failure/cancel we stay locked; the overlay's "Unlock" button retries.
    } finally {
      authingRef.current = false;
      setAuthing(false);
    }
  }, []);

  // Auto-trigger the OS prompt whenever we should be locked and can be.
  useEffect(() => {
    if (supported && walletConnected && locked) void runAuth();
  }, [supported, walletConnected, locked, runAuth]);

  // Clear the lock when the user has just satisfied OS auth outside this gate, so
  // `addresses` landing doesn't trip the auto-trigger above with a redundant second
  // prompt. Two paths fire this: a fresh interactive login, and a cold-start restore
  // that unsealed the auth-gated cached key (that keystore read IS an OS auth). A
  // restore that instead reconnects via Web3Auth (no cached key) does NOT fire it,
  // so it still requires biometrics here.
  useEffect(() => onFreshLogin(() => setLocked(false)), []);

  // Re-lock after the grace period on return from the background. We only react
  // to "background" (not "inactive") on purpose: the biometric sheet itself puts
  // the app into "inactive", so keying off that would re-lock during the prompt.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedAtRef.current = Date.now();
      } else if (next === "active") {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (bgAt != null && Date.now() - bgAt > GRACE_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  const reportNoSession = useCallback(() => setBootSettled(true), []);
  const value = { setWalletConnected, reportNoSession };

  const showLock = supported === true && walletConnected && locked;
  // Cover the app until we know the session status (device probe + boot settled),
  // but never over the lock — once a wallet is up the lock takes precedence.
  const showCover = !showLock && !(supported !== null && bootSettled);

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.container}>
        {children}
        {showCover && (
          <View style={styles.overlay}>
            <Image source={brandLogo} style={styles.coverLogo} resizeMode="contain" />
            <ActivityIndicator color={colors.primary} style={styles.coverSpinner} />
          </View>
        )}
        {showLock && (
          <View style={styles.overlay}>
            <View style={styles.lockBadge}>
              <LockGlyph />
            </View>
            <Text style={styles.appName}>Horizon Market</Text>
            <Text style={styles.subtitle}>
              Locked — authenticate to continue
            </Text>
            <Pressable
              onPress={() => void runAuth()}
              disabled={authing}
              style={({ pressed }) => [
                styles.unlockButton,
                (pressed || authing) && styles.unlockButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Unlock the app"
            >
              {authing ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={styles.unlockText}>Unlock</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </AppLockContext.Provider>
  );
}

/** lucide `lock` glyph, tinted with the brand primary. */
function LockGlyph() {
  return (
    <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={11}
        width={18}
        height={11}
        rx={2}
        ry={2}
        stroke={colors.primary}
        strokeWidth={2}
      />
      <Path
        d="M7 11V7a5 5 0 0 1 10 0v4"
        stroke={colors.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Opaque full-bleed cover: sits above every screen (Header included) so nothing
  // behind it is visible or tappable while locked.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  lockBadge: {
    width: 72,
    height: 72,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  appName: {
    fontSize: 22,
    color: colors.foreground,
    fontFamily: fonts.sansBold,
  },
  // Match the native splash (app.json imageWidth: 200) so the handoff is seamless.
  coverLogo: {
    width: 200,
    height: 200,
  },
  coverSpinner: {
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    fontFamily: fonts.sans,
    textAlign: "center",
  },
  unlockButton: {
    marginTop: spacing.md,
    minWidth: 200,
    height: 48,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  unlockButtonPressed: {
    opacity: 0.85,
  },
  unlockText: {
    fontSize: 15,
    color: colors.primaryForeground,
    fontFamily: fonts.sansBold,
  },
});
