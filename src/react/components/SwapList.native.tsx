import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { AtomicSwap } from "../../types/index.js";
import {
  useSwapList,
  SORT_OPTIONS,
  SORT_OPTION_LABELS,
  type UseSwapListOptions,
} from "../hooks/useSwapList.js";
import { FILTER_TABS } from "../internal/swapListConstants.js";
import { Dropdown } from "../internal/Dropdown.native.js";
import { useCommonSheet } from "../internal/styles.native.js";
import { ListHeader } from "../internal/ListHeader.native.js";
import { Modal } from "./Modal.native.js";
import {
  SwapListItem,
  type SwapListItemStyles,
} from "../internal/SwapListItem.native.js";
import type { LoginPanelStyles } from "./LoginPanel.native.js";
import { LoginPanel } from "./LoginPanel.native.js";
import type { SwapConfirmationStyles } from "./SwapConfirmation.native.js";
import { SwapConfirmation } from "./SwapConfirmation.native.js";

export type { SwapListingType, SortOption } from "../hooks/useSwapList.js";

export interface SwapListStyles {
  root?: StyleProp<ViewStyle>;
  toolbar?: StyleProp<ViewStyle>;
  filterTabs?: StyleProp<ViewStyle>;
  sortSelect?: StyleProp<ViewStyle>;
  mySwapsToggle?: StyleProp<ViewStyle>;
  grid?: StyleProp<ViewStyle>;
  item?: SwapListItemStyles;
  pagination?: StyleProp<ViewStyle>;
  error?: StyleProp<TextStyle>;
  empty?: StyleProp<TextStyle>;
  loginPanel?: LoginPanelStyles;
  confirmation?: SwapConfirmationStyles;
}

export interface SwapListProps extends UseSwapListOptions {
  /**
   * Platform-specific function to obtain the wallet private key.
   * Required for the login modal shown when an unauthenticated user clicks Buy.
   */
  getPrivateKey: (email: string) => Promise<string>;
  /**
   * Optional heading rendered above the toolbar, with a "Refresh" button pinned
   * to the right that re-fetches the swap list (same header pattern as
   * WalletBalances). A string is styled as a title; any other node renders as-is
   * (pass a styled `<Text>` to match the app's other screen titles).
   */
  title?: ReactNode;
  onSwapSelect?: (swap: AtomicSwap) => void;
  /**
   * When true, the toolbar (filters/sort) stays fixed and only the swap list
   * content scrolls. The root View expands to flex:1. Use this when SwapList
   * fills the remaining screen space below a sticky header.
   */
  scrollable?: boolean;
  /**
   * Content rendered at the very end of the (scrollable) list — e.g. a page
   * footer that should only come into view once the user scrolls to the bottom,
   * rather than staying pinned to the screen.
   */
  footerSlot?: ReactNode;
  style?: StyleProp<ViewStyle>;
  styles?: SwapListStyles;
}

export function SwapList({
  getPrivateKey,
  title,
  onSwapSelect,
  scrollable,
  footerSlot,
  style,
  styles: stylesProp,
  ...hookOptions
}: SwapListProps) {
  const common = useCommonSheet();

  const {
    swaps,
    isLoading,
    error,
    lastFetchedAt,
    listingType,
    setListingType,
    sortOption,
    setSortOption,
    showMySwaps,
    setShowMySwaps,
    canShowMySwaps,
    kontorUnavailable,
    page,
    setPage,
    totalPages,
    refetch,
    removeSwap,
    isItemMySwap,
    pendingSwap,
    loginModalOpen,
    confirmationModalOpen,
    confirmationMode,
    onItemAction,
    closeLoginModal,
    closeConfirmationModal,
    handleLoginSuccess,
  } = useSwapList(hookOptions);

  const contentAndPagination = (
    <>
      {/* Content */}
      {kontorUnavailable ? (
        <Text style={common.muted}>
          Kontor listings are only available on the signet network.
        </Text>
      ) : isLoading ? (
        <Text style={common.muted}>Loading…</Text>
      ) : error ? (
        <Text style={[common.error, stylesProp?.error]}>{error.message}</Text>
      ) : swaps.length === 0 ? (
        <Text style={[common.muted, stylesProp?.empty]}>No swaps found.</Text>
      ) : (
        <View style={[{ gap: 24 }, stylesProp?.grid]}>
          {Array.from({ length: Math.ceil(swaps.length / 2) }, (_, i) =>
            swaps.slice(i * 2, i * 2 + 2),
          ).map((row, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 16, alignItems: "stretch" }}>
              {row.map((swap) => (
                <SwapListItem
                  key={swap.id}
                  swap={swap}
                  isMySwap={isItemMySwap(swap)}
                  onAction={() => {
                    onSwapSelect?.(swap);
                    onItemAction(swap);
                  }}
                  style={{ flex: 1 }}
                  styles={stylesProp?.item}
                />
              ))}
              {row.length < 2 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <View
          style={[common.actions, { justifyContent: "center" }, stylesProp?.pagination]}
        >
          <Pressable
            disabled={page === 0}
            onPress={() => setPage(page - 1)}
            style={[common.buttonSecondary, page === 0 && common.buttonDisabled]}
          >
            <Text style={common.buttonSecondaryText}>←</Text>
          </Pressable>
          <Text style={[common.muted, { minWidth: 60, textAlign: "center" }]}>
            {page + 1} / {totalPages}
          </Text>
          <Pressable
            disabled={page >= totalPages - 1}
            onPress={() => setPage(page + 1)}
            style={[
              common.buttonSecondary,
              page >= totalPages - 1 && common.buttonDisabled,
            ]}
          >
            <Text style={common.buttonSecondaryText}>→</Text>
          </Pressable>
        </View>
      )}
    </>
  );

  return (
    <View
      style={[
        common.root,
        // Page-like container (no card chrome) so the grid sits directly on the
        // screen background, matching the Horizon Market home layout.
        { backgroundColor: "transparent", borderWidth: 0, borderRadius: 0, padding: 12 },
        scrollable && { flex: 1 },
        style,
        stylesProp?.root,
      ]}
    >
      {/* Optional heading + right-pinned "Updated …" + Refresh — the shared
          <ListHeader/> keeps this identical to WalletBalances' header. */}
      {title != null && (
        <ListHeader
          title={title}
          lastFetchedAt={lastFetchedAt}
          busy={isLoading}
          onRefresh={refetch}
        />
      )}

      {/* Toolbar: asset-type filter + sort dropdowns and, when signed in, the
          "My swaps" toggle — all on a single row at the same height (native has
          no <select>; keeps the controls compact). */}
      <View style={[common.swapToolbar, stylesProp?.toolbar]}>
        <Dropdown
          style={[common.flex1, stylesProp?.filterTabs]}
          title="Filter by type"
          value={listingType}
          onChange={setListingType}
          options={FILTER_TABS.map(({ key, label }) => ({ value: key, label }))}
        />
        <Dropdown
          style={[common.flex1, stylesProp?.sortSelect]}
          title="Sort by"
          value={sortOption}
          onChange={setSortOption}
          options={SORT_OPTIONS.map((key) => ({
            value: key,
            label: SORT_OPTION_LABELS[key],
          }))}
        />
        {canShowMySwaps && (
          <TouchableOpacity
            onPress={() => setShowMySwaps(!showMySwaps)}
            style={[
              common.toolbarToggle,
              showMySwaps && common.toolbarToggleActive,
              stylesProp?.mySwapsToggle,
            ]}
          >
            <Text
              style={[
                common.toolbarToggleText,
                showMySwaps && common.toolbarToggleTextActive,
              ]}
            >
              {showMySwaps ? "All swaps" : "My swaps"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content + Pagination. The footer slot rides at the end of the scroll so
          it's only revealed once the list is scrolled to the bottom. */}
      {scrollable ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, gap: 8 }}>
          {contentAndPagination}
          {footerSlot}
        </ScrollView>
      ) : (
        <>
          {contentAndPagination}
          {footerSlot}
        </>
      )}

      {/* Login modal */}
      <Modal
        open={loginModalOpen}
        onClose={closeLoginModal}
        title="Login or sign up"
      >
        <LoginPanel
          getPrivateKey={getPrivateKey}
          autoDetectSession={false}
          onSuccess={handleLoginSuccess}
          styles={stylesProp?.loginPanel}
        />
      </Modal>

      {/* Swap confirmation modal */}
      <Modal
        open={confirmationModalOpen && pendingSwap !== null}
        onClose={closeConfirmationModal}
        title={confirmationMode === "buy" ? "Buy" : "Delist"}
      >
        {pendingSwap && (
          <SwapConfirmation
            swap={pendingSwap}
            mode={confirmationMode}
            onBuySuccess={() => {
              removeSwap(pendingSwap.id);
              refetch();
            }}
            onDelistSuccess={() => {
              removeSwap(pendingSwap.id);
              refetch();
            }}
            onComplete={closeConfirmationModal}
            styles={stylesProp?.confirmation}
          />
        )}
      </Modal>
    </View>
  );
}
