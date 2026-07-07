import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Path } from "react-native-svg";
import {
  useHorizonMarket,
  Modal,
  LoginPanel,
  SellOrderForm,
  WalletBalanceSummary,
} from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey, logout as web3authLogout } from "../lib/web3auth.js";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

interface HeaderProps {
  /** Navigate to the standalone Wallet screen (lifted to App). */
  onOpenWallet: () => void;
}

/* ── Logo (text-based, matches the Horizon Market wordmark style) ─ */

function HorizonLogo() {
  return (
    <View style={styles.logoContainer}>
      <Text style={styles.logoText}>Horizon</Text>
    </View>
  );
}

/** Wallet mark — the same glyph the web header uses (lucide `Wallet`). */
function WalletIcon({ size = 22, color = colors.foreground }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 1 1-1v-2a1 1 0 0 0-1-1"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ── Address row ───────────────────────────────────────────── */

function AddressRow({ label, value }: { label: string; value: string }) {
  const copy = () => {
    Clipboard.setStringAsync(value)
      .then(() => {
        Alert.alert("Copied", `${label} address copied.`);
      })
      .catch(() => {});
  };

  const short = `${value.slice(0, 8)}…${value.slice(-6)}`;

  return (
    <TouchableOpacity style={styles.addressRow} onPress={copy} activeOpacity={0.7}>
      <Text style={styles.addressLabel}>{label}</Text>
      <Text style={styles.addressValue}>{short}</Text>
      <Text style={styles.copyHint}>Tap to copy</Text>
    </TouchableOpacity>
  );
}

/* ── Credits row ───────────────────────────────────────────── */

function CreditsRow({
  credits,
  freeCredits,
  signInError,
}: {
  credits: number | null;
  freeCredits: number | null;
  signInError: string | null;
}) {
  const loading = credits === null && freeCredits === null;
  const total = (credits ?? 0) + (freeCredits ?? 0);
  return (
    <View style={styles.creditsRow}>
      <Text style={styles.creditsLabel}>Credits</Text>
      {loading && signInError ? (
        <Text style={styles.signInError} numberOfLines={1}>
          {signInError}
        </Text>
      ) : (
        <Text style={styles.creditsValue}>{loading ? "…" : String(total)}</Text>
      )}
    </View>
  );
}

/* ── Header ────────────────────────────────────────────────── */

export function Header({ onOpenWallet }: HeaderProps) {
  const { addresses, logout, credits, freeCredits, signInError } =
    useHorizonMarket();
  const [loginOpen, setLoginOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  // "Open wallet" jumps to the wallet screen — close the menu first so it isn't
  // left floating over the new view.
  const handleOpenWallet = () => {
    setWalletOpen(false);
    onOpenWallet();
  };

  const handleSell = () => {
    if (addresses) {
      setSellOpen(true);
    } else {
      setLoginOpen(true);
    }
  };

  const handleLoginSuccess = () => {
    setLoginOpen(false);
    setSellOpen(true);
  };

  // Disconnect must clear *both* sessions: Horizon Market's local state (hides
  // the wallet icon) and the Web3Auth session (persisted in expo-secure-store).
  // Skipping the latter lets App.tsx's SessionRestorer silently reconnect on the
  // next mount / network switch.
  const handleLogout = async () => {
    try {
      await web3authLogout();
    } catch (err) {
      console.error("Web3Auth logout failed:", err);
    }
    logout();
  };

  return (
    <>
      <View style={styles.header}>
        {/* Brand */}
        <View style={styles.brand}>
          <HorizonLogo />
          <Text style={styles.tagline}>The DEX of Bitcoin metaprotocols</Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.sellButton} onPress={handleSell} activeOpacity={0.85}>
            <Text style={styles.sellButtonText}>Sell</Text>
          </TouchableOpacity>

          {addresses && (
            <TouchableOpacity
              style={styles.walletButton}
              onPress={() => setWalletOpen(true)}
              activeOpacity={0.85}
            >
              <WalletIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Login modal */}
      <Modal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title="Login or sign up"
      >
        {/* No onError handler: keep the modal open on failure so LoginPanel's own
            inline "✗ {message}" error surface is shown (mirrors the web Header). */}
        <LoginPanel
          getPrivateKey={getPrivateKey}
          onSuccess={handleLoginSuccess}
        />
      </Modal>

      {/* Sell modal — kept open on success so the result screen (success message
          + "New order" / "Close") is shown; "Close" dismisses the modal. */}
      <Modal open={sellOpen} onClose={() => setSellOpen(false)} title="Sell">
        <SellOrderForm onClose={() => setSellOpen(false)} />
      </Modal>

      {/* Wallet modal */}
      <Modal open={walletOpen} onClose={() => setWalletOpen(false)} title="Wallet">
        {addresses && (
          <>
            <AddressRow label="Segwit (P2WPKH)" value={addresses.p2wpkh} />
            {addresses.p2tr && (
              <AddressRow label="Taproot (P2TR)" value={addresses.p2tr} />
            )}
          </>
        )}

        <View style={styles.walletDivider} />

        <CreditsRow
          credits={credits}
          freeCredits={freeCredits}
          signInError={signInError}
        />

        <View style={styles.walletDivider} />

        {/* Compact balance summary (BTC / XCP / KOR / ZELD) from the SDK. */}
        <WalletBalanceSummary />

        <View style={styles.walletDivider} />

        {/* Footer: Disconnect (left) + Open wallet (right). */}
        <View style={styles.walletFooter}>
          <TouchableOpacity
            onPress={() => {
              setWalletOpen(false);
              void handleLogout();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleOpenWallet} activeOpacity={0.7}>
            <Text style={styles.openWalletText}>Open wallet →</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  header: {
    height: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  brand: {
    flexDirection: "column",
    gap: 2,
  },

  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  logoText: {
    fontSize: 20,
    color: colors.foreground,
    fontFamily: fonts.sansBold,
    letterSpacing: -0.5,
  },

  tagline: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
    letterSpacing: 0.2,
  },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  sellButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },

  sellButtonText: {
    fontSize: 14,
    color: colors.primaryForeground,
    fontFamily: fonts.sansBold,
  },

  walletButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  /* Wallet modal rows */
  addressRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    marginBottom: 4,
    backgroundColor: colors.surface,
  },

  addressLabel: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.sans,
    marginBottom: 2,
  },

  addressValue: {
    fontSize: 13,
    color: colors.foreground,
    fontFamily: fonts.mono,
    letterSpacing: 0.5,
  },

  copyHint: {
    fontSize: 10,
    color: colors.primary,
    marginTop: 2,
    fontFamily: fonts.sans,
  },

  walletDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },

  creditsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },

  creditsLabel: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.sans,
  },

  creditsValue: {
    fontSize: 15,
    color: colors.foreground,
    fontFamily: fonts.sansSemiBold,
  },

  signInError: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.error,
    fontFamily: fonts.sans,
  },

  walletFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },

  disconnectText: {
    fontSize: 14,
    color: colors.error,
    fontFamily: fonts.sansSemiBold,
  },

  openWalletText: {
    fontSize: 14,
    color: colors.primary,
    fontFamily: fonts.sansSemiBold,
  },
});
