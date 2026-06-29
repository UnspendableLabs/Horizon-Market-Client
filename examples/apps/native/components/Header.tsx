import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  useHorizonMarket,
  Modal,
  LoginPanel,
  SellOrderForm,
} from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey, logout as web3authLogout } from "../lib/web3auth.js";
import { colors, radii, spacing, fonts } from "../lib/theme.js";

/* ── Logo (text-based, matches the Horizon Market wordmark style) ─ */

function HorizonLogo() {
  return (
    <View style={styles.logoContainer}>
      <Text style={styles.logoText}>Horizon</Text>
      <View style={styles.logoMark} />
    </View>
  );
}

/* ── Address row ───────────────────────────────────────────── */

function AddressRow({ label, value }: { label: string; value: string }) {
  const copy = () => {
    Clipboard.setStringAsync(value).then(() => {
      Alert.alert("Copied", `${label} address copied.`);
    });
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

/* ── Header ────────────────────────────────────────────────── */

export function Header() {
  const { addresses, logout } = useHorizonMarket();
  const [loginOpen, setLoginOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

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
              <Text style={styles.walletIcon}>◈</Text>
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
        <LoginPanel
          getPrivateKey={getPrivateKey}
          onSuccess={handleLoginSuccess}
          onError={() => setLoginOpen(false)}
        />
      </Modal>

      {/* Sell modal */}
      <Modal open={sellOpen} onClose={() => setSellOpen(false)} title="Sell">
        <SellOrderForm onSuccess={() => setSellOpen(false)} />
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

        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={() => {
            setWalletOpen(false);
            void handleLogout();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
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

  logoMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
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

  walletIcon: {
    fontSize: 20,
    color: colors.foreground,
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

  disconnectButton: {
    paddingVertical: 12,
    alignItems: "center",
  },

  disconnectText: {
    fontSize: 14,
    color: colors.error,
    fontFamily: fonts.sansSemiBold,
  },
});
