import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
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
import { useCommonSheet } from "../internal/styles.native.js";
import {
  SwapListItem,
  type SwapListItemStyles,
} from "../internal/SwapListItem.native.js";
import type { LoginPanelStyles } from "./LoginPanel.native.js";
import { LoginPanel } from "./LoginPanel.native.js";
import type { SwapConfirmationStyles } from "./SwapConfirmation.native.js";
import { SwapConfirmation } from "./SwapConfirmation.native.js";

export type { SwapListingType, SortOption, SwapListView } from "../hooks/useSwapList.js";

export interface SwapListStyles {
  root?: StyleProp<ViewStyle>;
  toolbar?: StyleProp<ViewStyle>;
  filterTabs?: StyleProp<ViewStyle>;
  grid?: StyleProp<ViewStyle>;
  list?: StyleProp<ViewStyle>;
  item?: SwapListItemStyles;
  pagination?: StyleProp<ViewStyle>;
  loginPanel?: LoginPanelStyles;
  confirmation?: SwapConfirmationStyles;
}

export interface SwapListProps extends UseSwapListOptions {
  /**
   * Platform-specific function to obtain the wallet private key.
   * Required for the login modal shown when an unauthenticated user clicks Buy.
   */
  getPrivateKey: (email: string) => Promise<string>;
  onSwapSelect?: (swap: AtomicSwap) => void;
  /**
   * When true, the toolbar (filters/sort) stays fixed and only the swap list
   * content scrolls. The root View expands to flex:1. Use this when SwapList
   * fills the remaining screen space below a sticky header.
   */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  styles?: SwapListStyles;
}

const modalBackdropStyle = {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.55)",
  alignItems: "center" as const,
  justifyContent: "center" as const,
  padding: 16,
};

export function SwapList({
  getPrivateKey,
  onSwapSelect,
  scrollable,
  style,
  styles: stylesProp,
  ...hookOptions
}: SwapListProps) {
  const common = useCommonSheet();

  const {
    swaps,
    isLoading,
    error,
    listingType,
    setListingType,
    sortOption,
    setSortOption,
    view,
    setView,
    showMySwaps,
    setShowMySwaps,
    canShowMySwaps,
    kontorUnavailable,
    page,
    setPage,
    totalPages,
    refetch,
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
        <Text style={common.error}>{error.message}</Text>
      ) : swaps.length === 0 ? (
        <Text style={common.muted}>No swaps found.</Text>
      ) : view === "grid" ? (
        <View style={[{ gap: 24 }, stylesProp?.grid]}>
          {Array.from({ length: Math.ceil(swaps.length / 2) }, (_, i) =>
            swaps.slice(i * 2, i * 2 + 2),
          ).map((row, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 16, alignItems: "stretch" }}>
              {row.map((swap) => (
                <SwapListItem
                  key={swap.id}
                  swap={swap}
                  view={view}
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
      ) : (
        <View style={[{ gap: 8 }, stylesProp?.list]}>
          {swaps.map((swap) => (
            <SwapListItem
              key={swap.id}
              swap={swap}
              view={view}
              isMySwap={isItemMySwap(swap)}
              onAction={() => {
                onSwapSelect?.(swap);
                onItemAction(swap);
              }}
              styles={stylesProp?.item}
            />
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
      {/* Toolbar */}
      <View style={[common.swapToolbar, stylesProp?.toolbar]}>
        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[common.swapToolbar, stylesProp?.filterTabs]}
        >
          {FILTER_TABS.map(({ key, label }) => {
            const active = listingType === key;
            return (
              <TouchableOpacity
                key={key ?? "all"}
                onPress={() => setListingType(key)}
                style={active ? common.metaTabActive : common.metaTabInactive}
              >
                <Text
                  style={
                    active
                      ? common.metaTabTextActive
                      : common.metaTabTextInactive
                  }
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* View toggle */}
        <View style={common.swapToolbar}>
          <TouchableOpacity
            onPress={() => setView("grid")}
            style={
              view === "grid" ? common.filterTabActive : common.iconButton
            }
          >
            <Text
              style={
                view === "grid"
                  ? common.filterTabTextActive
                  : common.filterTabTextInactive
              }
            >
              ⊞
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setView("list")}
            style={
              view === "list" ? common.filterTabActive : common.iconButton
            }
          >
            <Text
              style={
                view === "list"
                  ? common.filterTabTextActive
                  : common.filterTabTextInactive
              }
            >
              ≡
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sort row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={common.swapToolbar}
      >
        {SORT_OPTIONS.map((key) => {
          const active = sortOption === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setSortOption(key)}
              style={active ? common.filterTabActive : common.filterTabInactive}
            >
              <Text
                style={
                  active
                    ? common.filterTabTextActive
                    : common.filterTabTextInactive
                }
              >
                {SORT_OPTION_LABELS[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* My swaps toggle */}
      {canShowMySwaps && (
        <TouchableOpacity
          onPress={() => setShowMySwaps(!showMySwaps)}
          style={
            showMySwaps ? common.filterTabActive : common.filterTabInactive
          }
        >
          <Text
            style={
              showMySwaps
                ? common.filterTabTextActive
                : common.filterTabTextInactive
            }
          >
            {showMySwaps ? "All swaps" : "My swaps"}
          </Text>
        </TouchableOpacity>
      )}

      {/* Content + Pagination */}
      {scrollable ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, gap: 8 }}>
          {contentAndPagination}
        </ScrollView>
      ) : (
        contentAndPagination
      )}

      {/* Login modal */}
      <Modal
        visible={loginModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeLoginModal}
      >
        <View style={modalBackdropStyle}>
          <View style={{ width: "100%", maxWidth: 420 }}>
            <LoginPanel
              getPrivateKey={getPrivateKey}
              autoDetectSession={false}
              onSuccess={handleLoginSuccess}
              styles={stylesProp?.loginPanel}
            />
            <Pressable
              onPress={closeLoginModal}
              style={[common.buttonSecondary, { marginTop: 8 }]}
            >
              <Text style={common.buttonSecondaryText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Swap confirmation modal */}
      <Modal
        visible={confirmationModalOpen && pendingSwap !== null}
        transparent
        animationType="fade"
        onRequestClose={closeConfirmationModal}
      >
        <View style={modalBackdropStyle}>
          <View style={{ width: "100%", maxWidth: 480 }}>
            {pendingSwap && (
              <SwapConfirmation
                swap={pendingSwap}
                mode={confirmationMode}
                onBuySuccess={() => refetch()}
                onDelistSuccess={() => refetch()}
                onComplete={closeConfirmationModal}
                styles={stylesProp?.confirmation}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
