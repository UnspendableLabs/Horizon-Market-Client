import { useCallback } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  SellOrderForm,
  useHorizonMarket,
} from "@unspendablelabs/horizon-market-client/react";
import { ConnectPrompt } from "../../components/ConnectPrompt.js";
import { useSellIntent } from "../../lib/sell-intent.js";
import { useBuyRefresh } from "../../lib/buy-refresh.js";
import { colors, fonts, spacing } from "../../lib/theme.js";
import {
  trackListingFormFailed,
  trackListingFormSuccess,
} from "../../lib/analytics/events.js";

/**
 * Sell tab: the SDK's <SellOrderForm/> as a full-screen, two-step mobile flow —
 * step 1 lists the sellable assets directly on the screen background (no card),
 * step 2 opens a per-asset detail with big quantity/price fields, and "Review
 * Order" pops the confirmation modal (mirroring the buy flow). When no wallet is
 * connected it falls back to the login gate.
 *
 * When reached from the Wallet tab's Sell action, `pendingAsset` is set and the
 * form opens straight to that asset's detail step (same screen as step 2); its
 * back button returns to the wallet.
 */
export default function SellScreen() {
  const { addresses } = useHorizonMarket();
  const router = useRouter();
  const { pendingAsset, nonce, clear } = useSellIntent();
  const { requestBuyRefresh } = useBuyRefresh();

  // Drop any pending "sell this asset" request when the tab loses focus, so
  // re-opening Sell from the tab bar always starts on the asset list (browse)
  // rather than a stale launched-from-wallet detail screen.
  useFocusEffect(
    useCallback(() => {
      return () => clear();
    }, [clear]),
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {addresses ? (
        pendingAsset ? (
          <SellOrderForm
            // Re-key per request so a new (or repeat) launch remounts the form
            // onto the detail step for the freshly chosen asset.
            key={`asset-${nonce}`}
            title={<Text style={styles.title}>Sell</Text>}
            initialAsset={pendingAsset}
            // Refresh the Buy list when the order is created; the detail Back
            // button returns to the wallet it came from, but closing the result
            // screen jumps to the Buy tab to see the new order at the top.
            onSuccess={(swap, created) => {
              trackListingFormSuccess({
                id: swap.id,
                listingType: swap.listingType,
                assetName: swap.assetName,
                inscriptionNumber: swap.inscriptionNumber,
                created,
              });
              requestBuyRefresh();
            }}
            onError={trackListingFormFailed}
            onClose={() => router.navigate("/wallet")}
            onDone={() => router.navigate("/")}
          />
        ) : (
          <SellOrderForm
            title={<Text style={styles.title}>Sell</Text>}
            // Once the order is created, refresh the Buy list; closing the result
            // screen jumps to the Buy tab to see it at the top.
            onSuccess={(swap, created) => {
              trackListingFormSuccess({
                id: swap.id,
                listingType: swap.listingType,
                assetName: swap.assetName,
                inscriptionNumber: swap.inscriptionNumber,
                created,
              });
              requestBuyRefresh();
            }}
            onError={trackListingFormFailed}
            onDone={() => router.navigate("/")}
          />
        )
      ) : (
        <>
          <Text style={styles.title}>Sell</Text>
          <ConnectPrompt message="Connect your wallet to list an asset for sale." />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
});
