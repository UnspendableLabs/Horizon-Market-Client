import type { CSSProperties } from "react";
import type { AtomicSwap } from "../../types/index.js";
import {
  useSwapList,
  SORT_OPTIONS,
  SORT_OPTION_LABELS,
  type UseSwapListOptions,
  type SortOption,
} from "../hooks/useSwapList.js";
import { cx } from "../internal/format.js";
import { FILTER_TABS } from "../internal/swapListConstants.js";
import {
  SwapListItem,
  type SwapListItemClassNames,
} from "../internal/SwapListItem.web.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
import type { LoginPanelClassNames } from "./LoginPanel.web.js";
import { LoginPanel } from "./LoginPanel.web.js";
import type { SwapConfirmationClassNames } from "./SwapConfirmation.web.js";
import { SwapConfirmation } from "./SwapConfirmation.web.js";
import { Modal } from "./Modal.web.js";

export type { SwapListingType, SortOption } from "../hooks/useSwapList.js";

export interface SwapListClassNames {
  root?: string;
  toolbar?: string;
  filterTabs?: string;
  sortSelect?: string;
  mySwapsToggle?: string;
  grid?: string;
  item?: SwapListItemClassNames;
  pagination?: string;
  error?: string;
  empty?: string;
  loginPanel?: LoginPanelClassNames;
  confirmation?: SwapConfirmationClassNames;
}

export interface SwapListProps extends UseSwapListOptions {
  /**
   * Platform-specific function to obtain the wallet private key.
   * Required for the login modal shown when an unauthenticated user clicks Buy.
   */
  getPrivateKey: (email: string) => Promise<string>;
  onSwapSelect?: (swap: AtomicSwap) => void;
  className?: string;
  classNames?: SwapListClassNames;
  style?: CSSProperties;
}

// Page-like container (no card chrome) so the grid sits directly on the page
// background, matching the Horizon Market home layout.
const rootStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingLg,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

const toolbarRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  marginLeft: "auto",
};

const paginationStyle: CSSProperties = {
  ...ws.actionsRow,
  justifyContent: "center",
  alignItems: "center",
};

const pageInfoStyle: CSSProperties = {
  ...ws.mutedText,
  minWidth: 80,
  textAlign: "center",
};

export function SwapList({
  getPrivateKey,
  onSwapSelect,
  className,
  classNames,
  style,
  ...hookOptions
}: SwapListProps) {
  const {
    swaps,
    isLoading,
    error,
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

  const root: CSSProperties = { ...rootStyle, ...style };

  return (
    <div className={cx(classNames?.root, className)} style={root}>
      {/* Toolbar */}
      <div
        className={classNames?.toolbar}
        style={{ ...ws.swapListToolbar, justifyContent: "space-between" }}
      >
        {/* Filter tabs */}
        <div
          className={classNames?.filterTabs}
          style={{ ...ws.actionsRow, alignItems: "flex-end", flexWrap: "wrap" as const }}
        >
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key ?? "all"}
              type="button"
              onClick={() => setListingType(key)}
              style={ws.metaTab(listingType === key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={toolbarRightStyle}>
          {/* Sort */}
          <select
            className={classNames?.sortSelect}
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            style={ws.input}
          >
            {SORT_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {SORT_OPTION_LABELS[key]}
              </option>
            ))}
          </select>

          {/* My swaps toggle */}
          {canShowMySwaps && (
            <button
              type="button"
              className={classNames?.mySwapsToggle}
              onClick={() => setShowMySwaps(!showMySwaps)}
              style={ws.filterTab(showMySwaps)}
            >
              {showMySwaps ? "All swaps" : "My swaps"}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {kontorUnavailable ? (
        <div className={classNames?.empty} style={ws.mutedText}>
          Kontor listings are only available on the signet network.
        </div>
      ) : isLoading ? (
        <div style={ws.mutedText}>Loading…</div>
      ) : error ? (
        <div className={classNames?.error} style={ws.errorText}>
          {error.message}
        </div>
      ) : swaps.length === 0 ? (
        <div className={classNames?.empty} style={ws.mutedText}>
          No swaps found.
        </div>
      ) : (
        <div className={classNames?.grid} style={ws.swapGrid}>
          {swaps.map((swap) => (
            <SwapListItem
              key={swap.id}
              swap={swap}
              isMySwap={isItemMySwap(swap)}
              onAction={() => {
                onSwapSelect?.(swap);
                onItemAction(swap);
              }}
              classNames={classNames?.item}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={classNames?.pagination} style={paginationStyle}>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            style={ws.withDisabled(ws.secondaryButton, page === 0)}
          >
            ←
          </button>
          <span style={pageInfoStyle}>
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
            style={ws.withDisabled(
              ws.secondaryButton,
              page >= totalPages - 1,
            )}
          >
            →
          </button>
        </div>
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
          classNames={classNames?.loginPanel}
        />
      </Modal>

      {/* Swap confirmation modal */}
      {confirmationModalOpen && pendingSwap && (
        <Modal
          open
          onClose={closeConfirmationModal}
          title={confirmationMode === "buy" ? "Buy" : "Delist"}
        >
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
            classNames={classNames?.confirmation}
          />
        </Modal>
      )}
    </div>
  );
}
