import type { CSSProperties } from "react";
import type { AtomicSwap, PendingSale } from "../../types/index.js";
import {
  useSwapList,
  SORT_OPTIONS,
  SORT_OPTION_LABELS,
  type UseSwapListOptions,
  type SortOption,
  type SwapListingType,
} from "../hooks/useSwapList.js";
import { cx } from "../internal/format.js";
import { useIsPhone } from "../internal/useMediaQuery.web.js";
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
  /**
   * Fired when a buy succeeds. Observation only — the built-in confirmation
   * modal still drives the UX unchanged. `sales` is the raw fill result
   * (asset-poor); `swap` is the full listing that was bought, so a host can
   * build a rich analytics payload and branch kontor-vs-multisig via
   * `swap.listingType` with no extra lookup.
   */
  onBuySuccess?: (swap: AtomicSwap, sales: PendingSale[]) => void;
  /** Fired when a buy fails. Observation only, mirrors {@link onBuySuccess}. */
  onBuyError?: (swap: AtomicSwap, error: Error) => void;
  /** Fired when delisting the viewer's own swap succeeds. Observation only. */
  onDelistSuccess?: (swap: AtomicSwap) => void;
  /** Fired when delisting fails. Observation only. */
  onDelistError?: (swap: AtomicSwap, error: Error) => void;
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

// On phones force exactly two tiles per row (mirrors the native grid, which
// chunks swaps into rows of 2). The desktop grid's 240px min-width would
// otherwise collapse to a single column on narrow screens.
const phoneSwapGrid: CSSProperties = {
  ...ws.swapGrid,
  // minmax(0, 1fr) — not 1fr — so both columns stay exactly equal width. A bare
  // 1fr track resolves to minmax(auto, 1fr), letting a tile whose content is
  // wider than its share refuse to shrink and steal width from its neighbour.
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  columnGap: 16,
  rowGap: 24,
};

export function SwapList({
  getPrivateKey,
  onSwapSelect,
  onBuySuccess,
  onBuyError,
  onDelistSuccess,
  onDelistError,
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
    trackPendingBuy,
    isItemMySwap,
    pendingOrders,
    pendingSwap,
    loginModalOpen,
    confirmationModalOpen,
    confirmationMode,
    onItemAction,
    closeLoginModal,
    closeConfirmationModal,
    handleLoginSuccess,
    // Surface the connected wallet's in-progress orders at the top of the list
    // (see the pending section below). Consumers can opt out with
    // `includePendingOrders={false}`.
  } = useSwapList({ includePendingOrders: true, ...hookOptions });

  const isPhone = useIsPhone();
  const root: CSSProperties = { ...rootStyle, ...style };

  // The connected wallet's in-progress orders ride at the very top of the grid
  // (the API already sorts them first via `pending_address`), rendered as
  // ordinary tiles with a "Pending" badge and no Buy action. They're a small
  // personal set pinned to the first page only. Pending sell listings are
  // `funded:false` and pending buys are `pending:true`, both already excluded
  // from the main feed, so there's no overlap to dedupe.
  const gridSwaps = page === 0 ? [...pendingOrders, ...swaps] : swaps;

  // Sort + My-swaps controls are identical in both layouts; only the sort
  // select stretches to share the row on phones (flex:1), so build them once.
  const sortSelect = (
    <select
      className={classNames?.sortSelect}
      value={sortOption}
      onChange={(e) => setSortOption(e.target.value as SortOption)}
      style={isPhone ? { ...ws.input, flex: 1, minWidth: 0 } : ws.input}
    >
      {SORT_OPTIONS.map((key) => (
        <option key={key} value={key}>
          {SORT_OPTION_LABELS[key]}
        </option>
      ))}
    </select>
  );

  const mySwapsToggle = canShowMySwaps ? (
    <button
      type="button"
      className={classNames?.mySwapsToggle}
      onClick={() => setShowMySwaps(!showMySwaps)}
      style={ws.filterTab(showMySwaps)}
    >
      {showMySwaps ? "All swaps" : "My swaps"}
    </button>
  ) : null;

  return (
    <div className={cx(classNames?.root, className)} style={root}>
      {/* Toolbar. On phones the metaprotocol filter collapses into a <select>
          that shares one row with Sort + My swaps (mirrors the native toolbar);
          on wider screens the filter is a row of underline tabs on the left with
          Sort + My swaps pinned to the right. */}
      {isPhone ? (
        <div
          className={classNames?.toolbar}
          style={{ ...ws.swapListToolbar, flexWrap: "nowrap" as const }}
        >
          <select
            className={classNames?.filterTabs}
            aria-label="Filter by type"
            value={listingType ?? "all"}
            onChange={(e) =>
              setListingType(
                e.target.value === "all"
                  ? null
                  : (e.target.value as SwapListingType),
              )
            }
            style={{ ...ws.input, flex: 1, minWidth: 0 }}
          >
            {FILTER_TABS.map(({ key, label }) => (
              <option key={key ?? "all"} value={key ?? "all"}>
                {label}
              </option>
            ))}
          </select>
          {sortSelect}
          {mySwapsToggle}
        </div>
      ) : (
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
            {sortSelect}
            {mySwapsToggle}
          </div>
        </div>
      )}

      {/* Content — the connected wallet's in-progress orders (pending listings
          still settling + purchases still confirming) ride at the top of the
          grid as ordinary tiles marked "Pending". */}
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
      ) : gridSwaps.length === 0 ? (
        <div className={classNames?.empty} style={ws.mutedText}>
          No swaps found.
        </div>
      ) : (
        <div
          className={classNames?.grid}
          style={isPhone ? phoneSwapGrid : ws.swapGrid}
        >
          {gridSwaps.map((swap) => (
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
            onBuySuccess={(sales) => {
              // A Kontor buy settles on-chain async and the server's pending
              // decoration can lag; track it locally so it shows as pending
              // immediately and refreshes balances once it settles.
              if (pendingSwap.listingType === "kontor") {
                trackPendingBuy(pendingSwap, sales[0]?.txId ?? null);
              }
              removeSwap(pendingSwap.id);
              refetch();
              onBuySuccess?.(pendingSwap, sales);
            }}
            onDelistSuccess={() => {
              removeSwap(pendingSwap.id);
              refetch();
              onDelistSuccess?.(pendingSwap);
            }}
            onError={(error) => {
              if (confirmationMode === "buy") onBuyError?.(pendingSwap, error);
              else onDelistError?.(pendingSwap, error);
            }}
            onComplete={closeConfirmationModal}
            classNames={classNames?.confirmation}
          />
        </Modal>
      )}
    </div>
  );
}
