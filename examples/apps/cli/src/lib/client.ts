import { HorizonMarketClient } from "@unspendablelabs/horizon-market-client";
import type { NetworkConfig } from "./networks.js";

/** Options for building a client — pass `mnemonic` for write ops, omit for read-only. */
export interface CreateClientOptions {
  mnemonic?: string;
  mnemonicOptions?: { account?: number; passphrase?: string };
}

/**
 * Build a `HorizonMarketClient` for a network. Without a `mnemonic` the client is
 * read-only (public reads only — no signer). The CLI-only `ordApiBaseUrl` is NOT
 * a client option (the ord server is queried directly by `lib/ordinals.ts`).
 */
export function createClient(
  cfg: NetworkConfig,
  opts: CreateClientOptions = {},
): HorizonMarketClient {
  return new HorizonMarketClient({
    ...(opts.mnemonic
      ? { mnemonic: opts.mnemonic, mnemonicOptions: opts.mnemonicOptions }
      : {}),
    network: cfg.sdkNetwork,
    baseUrl: cfg.baseUrl,
    counterpartyApiBaseUrl: cfg.counterpartyApiBaseUrl,
    zeldApiBaseUrl: cfg.zeldApiBaseUrl,
    kontorNetwork: cfg.kontorNetwork,
    kontorIndexerUrl: cfg.kontorIndexerUrl,
    kontorNftContractAddress: cfg.kontorNftContractAddress,
  });
}
