import { useEffect, useState } from "react";
import { useAssets } from "../hooks/useAssets.js";
import {
  useSellOrder,
  type SellOrderFormValues,
  type UseSellOrderOptions,
  type UseSellOrderResult,
} from "../hooks/useSellOrder.js";

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
  const [search, setSearch] = useState("");

  useEffect(() => {
    assets.searchCounterparty(search);
  }, [search, assets.searchCounterparty]);

  const showQuantity = sellOrder.formValues.asset?.type !== "ordinal";
  const submitDisabled = !isFormValid(sellOrder.formValues, showQuantity);

  return { ...sellOrder, assets, search, setSearch, showQuantity, submitDisabled };
}

function isFormValid(
  values: SellOrderFormValues,
  showQuantity: boolean,
): boolean {
  if (!values.asset) return false;
  const price = Number(values.priceSats);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (showQuantity) {
    if (!values.quantity) return false;
    try {
      if (BigInt(values.quantity) <= 0n) return false;
    } catch {
      return false;
    }
  }
  return true;
}
