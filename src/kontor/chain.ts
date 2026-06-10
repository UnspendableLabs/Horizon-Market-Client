import { signet, ContractAddress, type Chain } from "@kontor/sdk";

/**
 * Resolve the `@kontor/sdk` Chain for a given Kontor network.
 *
 * Only "signet" is supported by the SDK today; everything else returns null and
 * the caller should treat Kontor as unavailable. Ported from the Horizon-Market
 * server's `kontorChain()`.
 */
export function resolveKontorChain(
  kontorNetwork: string | undefined,
): Chain | null {
  switch (kontorNetwork) {
    case "signet":
      return signet;
    default:
      // mainnet and testnet4 are not yet available in the SDK.
      return null;
  }
}

/** Build the native KOR token ContractAddress from the chain's nativeToken config. */
export function nativeTokenContractAddress(chain: Chain): ContractAddress {
  const nt = chain.contracts?.nativeToken;
  if (nt == null) {
    throw new Error(`Kontor chain '${chain.name}' has no nativeToken configured`);
  }
  return new ContractAddress(nt.name, nt.height, nt.txIndex);
}

/** Native KOR token contract address string (e.g. "token@0.0" on signet). */
export function kontorNativeTokenAddress(chain: Chain): string {
  return nativeTokenContractAddress(chain).toString();
}
