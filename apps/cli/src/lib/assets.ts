import type {
  HorizonMarketClient,
} from "@unspendablelabs/horizon-market-client";
import { CliError } from "./output.js";
import type { AddressPair } from "./wallet.js";

/** A resolved, owned Counterparty balance for a specific asset. */
export interface OwnedCounterparty {
  assetName: string;
  /** Holding address (p2wpkh — Counterparty balances live on Segwit). */
  address: string;
  /** Balance in base units. */
  balance: bigint;
  quantityNormalized: string;
  divisible: boolean;
}

/** A resolved, owned ZELD balance. */
export interface OwnedZeld {
  address: string;
  balance: bigint;
  quantityNormalized: string;
}

/**
 * Find an owned Counterparty (or XCP) asset by name across the wallet's
 * addresses. Throws when the asset isn't held (or when no Counterparty API is
 * configured for the network — `getCounterpartyBalances` returns `[]`).
 */
export async function findCounterpartyAsset(
  client: HorizonMarketClient,
  addresses: AddressPair,
  assetName: string,
): Promise<OwnedCounterparty> {
  const balances = await client.getCounterpartyBalances([
    addresses.p2wpkh,
    addresses.p2tr,
  ]);
  const match = balances.find((b) => b.asset === assetName);
  if (!match) {
    throw new CliError(
      `You don't hold any ${assetName} (checked ${addresses.p2wpkh}, ${addresses.p2tr})`,
      "ASSET_NOT_OWNED",
    );
  }
  return {
    assetName: match.asset,
    address: match.address,
    balance: match.quantity,
    quantityNormalized: match.quantityNormalized,
    divisible: match.divisible,
  };
}

/**
 * Find the wallet's ZELD balance (its own protocol, mainnet only). Throws when
 * none is held or ZELD isn't configured for the network.
 */
export async function findZeldAsset(
  client: HorizonMarketClient,
  addresses: AddressPair,
): Promise<OwnedZeld> {
  const balances = await client.getZeldBalances([addresses.p2wpkh, addresses.p2tr]);
  const match = balances.find((b) => b.balance > 0n);
  if (!match) {
    throw new CliError("You don't hold any ZELD (mainnet only)", "ASSET_NOT_OWNED");
  }
  return {
    address: match.address,
    balance: match.balance,
    quantityNormalized: match.quantityNormalized,
  };
}
