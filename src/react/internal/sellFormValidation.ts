import type { OpenSellOrderParams } from "../../workflows/sell.js";
import type { AssetOption } from "../hooks/useAssets.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";

export function showQuantityForAsset(asset: AssetOption | null): boolean {
  return asset?.type !== "ordinal";
}

/**
 * Returns `null` when valid, otherwise an `Error` describing the first failure.
 */
export function validateSellForm(
  values: SellOrderFormValues,
  defaultSatsPerVbyte?: number,
): Error | null {
  try {
    buildSellOrderParams(values, defaultSatsPerVbyte);
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export function isSellFormValid(values: SellOrderFormValues): boolean {
  const showQuantity = showQuantityForAsset(values.asset);
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

export function buildSellOrderParams(
  values: SellOrderFormValues,
  defaultSatsPerVbyte?: number,
): OpenSellOrderParams {
  const asset = values.asset;
  if (!asset) throw new Error("No asset selected");

  const priceSats = Number(values.priceSats);
  if (!Number.isFinite(priceSats) || priceSats <= 0) {
    throw new Error("Invalid price");
  }

  const base = {
    priceSats,
    autoSelectFeeUtxos: true,
    ...(defaultSatsPerVbyte !== undefined
      ? { satsPerVbyte: defaultSatsPerVbyte }
      : {}),
  };

  if (asset.type === "ordinal") {
    return {
      ...base,
      listingType: "ordinal",
      assetUtxoId: asset.utxoId,
    };
  }

  if (!values.quantity) throw new Error("Quantity required");
  const quantity = BigInt(values.quantity);
  if (quantity <= 0n) throw new Error("Invalid quantity");

  if (asset.type === "zeld") {
    return {
      ...base,
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: quantity,
    };
  }

  return {
    ...base,
    listingType: "counterparty",
    assetName: asset.assetName,
    assetQuantity: quantity,
  };
}
