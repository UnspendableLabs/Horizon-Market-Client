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

  // One modal instance with a "mode" discriminator, NOT three sibling <Modal>s.
  // On iOS each RN <Modal> is presented as its own UIViewController/window; mounting
  // several and — on login success — dismissing one while presenting another in the
  // same tick (the old setLoginOpen(false) + setSellOpen(true)) wedges iOS's
  // presentation: a transparent modal window is left on top that swallows every tap,
  // so the header's Sell/Wallet buttons stop responding with no press feedback.
  // Android uses a different presentation model, so it never reproduced there.
  // Keeping ONE modal mounted and only swapping its content (login → sell) never
  // dismisses/re-presents natively, so there's no race.
  const [modalMode, setModalMode] = useState<null | "login" | "sell" | "wallet">(
    null,
  );
  const closeModal = () => setModalMode(null);

  // "Open wallet" jumps to the wallet screen — close the menu first so it isn't
  // left floating over the new view.
  const handleOpenWallet = () => {
    closeModal();
    onOpenWallet();
  };

  const handleSell = () => {
    setModalMode(addresses ? "sell" : "login");
  };

  // Swap the open modal's content from login → sell in place (the modal stays
  // presented; no native dismiss/re-present, which is the part iOS chokes on).
  const handleLoginSuccess = () => {
    setModalMode("sell");
  };

  // Disconnect must clear *both* sessions: Horizon Market's local state (hides
  // the wallet icon) and the Web3Auth session (persisted in expo-secure-store).
  // Skipping the latter lets App.tsx's SessionRestorer silently reconnect on the
  // next mount / network switch.
  //
  // Update the local UI *first*, then revoke Web3Auth in the background: after a
  // fast-path cold-start restore, Web3Auth was never initialized this session, so
  // web3authLogout() pays its multi-second lazy init just to revoke the server
  // session. Awaiting that before the local logout() would freeze the button for
  // seconds. web3authLogout() wipes the cached key up front, so nothing reconnects.
  const handleLogout = () => {
    logout();
    web3authLogout().catch((err) => {
      console.error("Web3Auth logout failed:", err);
    });
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
              onPress={() => setModalMode("wallet")}
              activeOpacity={0.85}
            >
              <WalletIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* One shared modal (see the modalMode note above). Its title + content
          switch on the active mode; login → sell swaps content in place without a
          native re-present. The sell view is kept mounted on success so its result
          screen (success message + "New order" / "Close") is shown. */}
      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={
          modalMode === "login"
            ? "Login or sign up"
            : modalMode === "sell"
              ? "Sell"
              : "Wallet"
        }
      >
        {modalMode === "login" && (
          /* No onError handler: keep the modal open on failure so LoginPanel's own
             inline "✗ {message}" error surface is shown (mirrors the web Header). */
          <LoginPanel getPrivateKey={getPrivateKey} onSuccess={handleLoginSuccess} />
        )}

        {modalMode === "sell" && <SellOrderForm onClose={closeModal} />}

        {modalMode === "wallet" && (
          <>
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
                  closeModal();
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
          </>
        )}
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
