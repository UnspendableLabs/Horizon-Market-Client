// WASM-free swap-list logic. This entry re-exports the pure display derivations
// (`swapDisplayName`, `swapDisplayTitle`, `swapListItemView`, `mergeSwapsById`,
// `sortSwaps`, `paginateSwaps`, `clampPage`, `getSellerAddresses`, `checkIsMySwap`,
// …) and the list constants / sort presets / types (`DEFAULT_LIMIT`, `FILTER_TABS`,
// `SORT_OPTIONS`, `SORT_OPTION_LABELS`, `SORT_MAP`, `SortOption`, `SwapListingType`,
// `SwapListOrderBy`, `SwapListOrder`, the `PENDING_ORDERS_*` / `MY_SWAPS_*` caps, …)
// that power the packaged <SwapList/> and useSwapList.
//
// Unlike the main (".") and "./react" barrels — both of which statically import
// `@kontor/sdk`, which compiles WebAssembly on import and crashes Node / SSR — this
// module has ZERO runtime dependency on `@kontor/sdk`, `bitcoinjs-lib`, `@scure/*`,
// `ecpair`, or even React. Import it from
// `@unspendablelabs/horizon-market-client/swaps` in Node-run unit tests and
// SSR-reachable code that must never trigger the eager WASM compile, so an app can
// build its own faceted swap browser on the exact same pure logic the SDK ships —
// no duplication.
export * from "../react/internal/swapListHelpers.js";
export * from "../react/internal/swapListConstants.js";
