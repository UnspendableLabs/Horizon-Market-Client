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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Image, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";
import { authenticate, canUseAppLock } from "../lib/app-lock.js";
import { onFreshLogin } from "../lib/app-lock-events.js";
import { hasPersistedSession } from "../lib/web3auth.js";
import { colors } from "../lib/theme.js";

/** How long the app may sit in the background before it re-locks on return. */
const GRACE_MS = 30_000;

// Both the boot cover AND the lock overlay are seamless continuations of the native
// splash: same H mark (assets/icon.png), same size (200px, matching app.json →
// expo-splash-screen's imageWidth), same background, centered on the FULL screen
// (see the -insets.top offset below). So the OS splash → boot cover → lock handoff
// is invisible: the user just sees the splash logo, unmoving, while the OS auth sheet
// slides over it. No wordmark, tagline, spinner, or Unlock button — just the H.
const brandMark = require("../assets/icon.png");

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
  // The overlays live inside the app's SafeAreaView (top inset), but the native
  // splash centers on the FULL screen. Pull the overlay up by the top inset so its
  // logo lands on the true screen center — otherwise it sits ~half the status-bar
  // height too low and the splash → cover handoff visibly jumps.
  const insets = useSafeAreaInsets();
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
      // Ignore any AppState churn while our OS auth is in flight: iOS drives the
      // app to "inactive" during the sheet, but Android's device-credential
      // fallback can drive it all the way to "background" — stamping the grace
      // clock there would re-lock (fighting the unlock we're resolving) if the
      // user lingers past GRACE_MS at the passcode prompt. `authing` brackets the
      // whole authenticate() call, so skipping while it's set is safe: a genuine
      // background during that window leaves the app locked anyway.
      if (authingRef.current) return;
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
  // Stable context value — its members (a useState setter + a useCallback) never
  // change, so memoizing keeps consumers (AppLockBridge, SessionRestorer) from
  // re-rendering on every lock/boot state transition here.
  const value = useMemo(
    () => ({ setWalletConnected, reportNoSession }),
    [reportNoSession],
  );

  const showLock = supported === true && walletConnected && locked;
  // Cover the app until we know the session status (device probe + boot settled),
  // but never over the lock — once a wallet is up the lock takes precedence.
  const showCover = !showLock && !(supported !== null && bootSettled);

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.container}>
        {children}
        {showCover && (
          <View style={[styles.overlay, { top: -insets.top }]}>
            <Image
              source={brandMark}
              style={styles.coverLogo}
              resizeMode="contain"
            />
          </View>
        )}
        {/* The lock screen is visually the splash: just the H. The OS auth sheet
            (auto-triggered above) slides over it, so there's no in-app button or
            text to flash before/after the system prompt. If the user cancels the
            sheet, a tap anywhere re-runs auth (runAuth is re-entrancy guarded). */}
        {showLock && (
          <Pressable
            style={[styles.overlay, { top: -insets.top }]}
            onPress={() => void runAuth()}
            disabled={authing}
            accessibilityRole="button"
            accessibilityLabel="Authenticate to unlock"
          >
            <Image
              source={brandMark}
              style={styles.coverLogo}
              resizeMode="contain"
            />
          </Pressable>
        )}
      </View>
    </AppLockContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Opaque full-bleed cover: sits above every screen so nothing behind it is
  // visible or tappable. Extended to the full screen (top: -insets.top, applied
  // inline) so its centered logo lands exactly where the native splash's does.
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  // The H mark alone, sized to match the native splash (app.json imageWidth: 200)
  // so the JS cover is a pixel-continuation of the OS splash. Square: icon.png
  // carries its own dark padding, so `contain` on colors.background is seamless.
  coverLogo: {
    width: 200,
    height: 200,
  },
});
