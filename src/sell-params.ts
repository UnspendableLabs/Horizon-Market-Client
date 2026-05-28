import { assertMutuallyExclusive } from "./assert.js";
import type { Signer } from "./crypto/signer.js";
import type { ListingType, Network } from "./types/index.js";

export interface SellListingParams {
  listingType?: ListingType;
  sellerAddress?: string;
  assetUtxoId?: string;
  assetName?: string;
  assetQuantity?: bigint | number;
  feeUtxoIds?: string[];
  autoSelectFeeUtxos?: boolean;
}

export function isTaprootAddress(address: string): boolean {
  return address.startsWith("bc1p") || address.startsWith("tb1p");
}

export function assertZeldMainnet(
  listingType: ListingType | undefined,
  network: Network,
): void {
  if (listingType === "zeld" && network !== "mainnet") {
    throw new Error("ZELD listings are only supported on mainnet");
  }
}

export function resolveSellerPubkey(
  sellerAddress: string,
  explicitPubkey: string | undefined,
  addresses: ReturnType<Signer["getAddresses"]>,
): string | undefined {
  if (explicitPubkey !== undefined) return explicitPubkey;
  if (addresses.p2tr && sellerAddress === addresses.p2tr) {
    return addresses.xOnlyPubkey;
  }
  return undefined;
}

export function assertTaprootSellerPubkey(
  sellerAddress: string,
  sellerPubkey: string | undefined,
): void {
  if (isTaprootAddress(sellerAddress) && !sellerPubkey) {
    throw new Error(
      "P2TR sellerAddress requires sellerPubkey (32-byte x-only hex). " +
        "Pass sellerPubkey explicitly or use the signer's P2TR address.",
    );
  }
}

/** Ordinal listings must use a P2TR seller address (bc1p… / tb1p…). */
export function assertOrdinalSellerAddress(
  listingType: ListingType | undefined,
  sellerAddress: string,
): void {
  if (listingType === "ordinal" && !isTaprootAddress(sellerAddress)) {
    throw new Error(
      "Ordinal listings require a P2TR seller address (bc1p… or tb1p…)",
    );
  }
}

/**
 * Client-side guards for sell-quotes / openSellOrder (server 400 otherwise).
 */
export function assertSellListingParams(params: SellListingParams): void {
  assertMutuallyExclusive(
    params.feeUtxoIds,
    params.autoSelectFeeUtxos,
    "feeUtxoIds",
    "autoSelectFeeUtxos",
  );

  const listingType = params.listingType ?? "counterparty";

  if (params.assetName === "ZELD" && listingType !== "zeld") {
    throw new Error(
      'assetName "ZELD" requires listingType: "zeld" (omit listingType defaults to "counterparty")',
    );
  }

  if (listingType === "ordinal" && !params.assetUtxoId) {
    throw new Error("Ordinal listings require assetUtxoId");
  }

  if (params.sellerAddress !== undefined) {
    assertOrdinalSellerAddress(listingType, params.sellerAddress);
  }

  if (listingType === "zeld") {
    if (params.assetName !== "ZELD") {
      throw new Error('ZELD listings require assetName: "ZELD"');
    }
  }

  if (params.assetUtxoId) {
    if (listingType === "counterparty" || listingType === "zeld") {
      if (!params.assetName) {
        throw new Error(
          `${listingType} listings with assetUtxoId require assetName`,
        );
      }
      if (params.assetQuantity === undefined) {
        throw new Error(
          `${listingType} listings with assetUtxoId require assetQuantity`,
        );
      }
    }
    return;
  }

  // Compose prep (no asset_utxo_id upfront)
  if (listingType === "counterparty") {
    if (!params.assetName) {
      throw new Error("Counterparty attach prep requires assetName");
    }
    if (params.assetQuantity === undefined) {
      throw new Error("Counterparty attach prep requires assetQuantity");
    }
  } else if (listingType === "zeld") {
    if (params.assetQuantity === undefined) {
      throw new Error("ZELD transfer prep requires assetQuantity");
    }
  }
}
