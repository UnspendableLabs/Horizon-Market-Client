import type { OpenSellOrderParams } from "../../workflows/sell.js";
import type { AssetOption } from "../hooks/useAssets.js";
import type { SellOrderFormValues } from "../hooks/useSellOrder.js";
import { toBaseUnits } from "./format.js";

/** Quantity is hidden for 1-of-1 assets (ordinals and Kontor NFTs). */
export function showQuantityForAsset(asset: AssetOption | null): boolean {
  return asset?.type !== "ordinal" && asset?.type !== "kontor-nft";
}

/** Whether `asset` carries a base-unit balance the quantity must not exceed. */
function divisibleOf(asset: AssetOption): boolean {
  if (asset.type === "counterparty") return asset.divisible;
  if (asset.type === "zeld") return true;
  return true;
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
  const asset = values.asset;
  if (!asset) return false;
  const price = Number(values.priceSats);
  if (!Number.isFinite(price) || price <= 0) return false;

  if (!showQuantityForAsset(asset)) return true;

  // KOR uses a decimal string (no base-unit balance cap here).
  if (asset.type === "kor") {
    const amount = Number(values.quantity);
    return Number.isFinite(amount) && amount > 0;
  }

  if (!values.quantity) return false;
  let base: bigint;
  try {
    base = toBaseUnits(values.quantity, divisibleOf(asset));
  } catch {
    return false;
  }
  if (base <= 0n) return false;

  // Reject quantities exceeding the selected asset's owned balance.
  if (asset.type === "counterparty" || asset.type === "zeld") {
    if (base > asset.balance) return false;
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
      sellerAddress: asset.address,
    };
  }

  if (asset.type === "kontor-nft") {
    return {
      ...base,
      listingType: "kontor",
      kontorAssetKind: "nft",
      nftId: asset.nftId,
      nftContractAddress: asset.contractAddress,
    };
  }

  if (asset.type === "kor") {
    const amount = Number(values.quantity);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid quantity");
    }
    return {
      ...base,
      listingType: "kontor",
      kontorAssetKind: "token",
      korAmount: values.quantity,
    };
  }

  if (!values.quantity) throw new Error("Quantity required");
  const quantity = toBaseUnits(values.quantity, divisibleOf(asset));
  if (quantity <= 0n) throw new Error("Invalid quantity");
  if (quantity > asset.balance) {
    throw new Error("Quantity exceeds balance");
  }

  if (asset.type === "zeld") {
    return {
      ...base,
      listingType: "zeld",
      assetName: "ZELD",
      assetQuantity: quantity,
      sellerAddress: asset.address,
    };
  }

  return {
    ...base,
    listingType: "counterparty",
    assetName: asset.assetName,
    assetQuantity: quantity,
    sellerAddress: asset.address,
  };
}
