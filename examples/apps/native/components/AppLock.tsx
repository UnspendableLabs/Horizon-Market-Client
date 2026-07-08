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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { authenticate, canUseAppLock } from "../lib/app-lock.js";
import { onFreshLogin } from "../lib/app-lock-events.js";
import { colors, fonts, radii, spacing } from "../lib/theme.js";

/** How long the app may sit in the background before it re-locks on return. */
const GRACE_MS = 30_000;

interface AppLockContextValue {
  /** Reported by <AppLockBridge/> inside the provider: is a wallet session live? */
  setWalletConnected: (connected: boolean) => void;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within <AppLockProvider>");
  return ctx;
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

  // A fresh interactive login counts as unlocking: the user just authenticated,
  // so clear the lock before `addresses` land (which would otherwise trip the
  // auto-trigger above). Restores at cold start don't fire this, so they still
  // require biometrics.
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

  const value = { setWalletConnected };
  const showOverlay = supported === true && walletConnected && locked;

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.container}>
        {children}
        {showOverlay && (
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
