import { useCallback, useEffect, useRef, useState } from "react";
import { useAssets } from "../hooks/useAssets.js";
import {
  useSellOrder,
  type UseSellOrderOptions,
  type UseSellOrderResult,
} from "../hooks/useSellOrder.js";
import {
  isSellFormValid,
  showQuantityForAsset,
} from "./sellFormValidation.js";

export interface UseSellOrderFormControllerResult extends UseSellOrderResult {
  assets: ReturnType<typeof useAssets>;
  search: string;
  setSearch: (q: string) => void;
  showQuantity: boolean;
  submitDisabled: boolean;
}

/**
 * Shared controller for the platform-specific `SellOrderForm` components.
 * Wraps `useSellOrder` + `useAssets`, manages the search input, and exposes
 * the derived flags (`showQuantity`, `submitDisabled`) used by both renderers.
 */
export function useSellOrderFormController(
  options?: UseSellOrderOptions,
): UseSellOrderFormControllerResult {
  const sellOrder = useSellOrder(options);
  const assets = useAssets();
  const [search, setSearchState] = useState("");

  const setSearch = useCallback(
    (q: string) => {
      setSearchState(q);
      assets.searchCounterparty(q);
    },
    [assets.searchCounterparty],
  );

  // Pre-populate counterparty list when the client first connects.
  // Uses a ref for the current search value so the effect only re-runs
  // when searchCounterparty changes (client connects/changes), not on every keystroke.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    assets.searchCounterparty(searchRef.current);
  }, [assets.searchCounterparty]);

  const showQuantity = showQuantityForAsset(sellOrder.formValues.asset);
  const submitDisabled = !isSellFormValid(sellOrder.formValues);

  return { ...sellOrder, assets, search, setSearch, showQuantity, submitDisabled };
}
