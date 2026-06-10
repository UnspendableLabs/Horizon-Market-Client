import type { Chain } from "@kontor/sdk";
import type * as btc from "bitcoinjs-lib";

/**
 * Resolved Kontor runtime context, built once by the client and passed into the
 * Kontor workflows. Carries no secrets — only the chain, indexer URL, and the
 * bitcoin network used to derive funding scriptPubKeys.
 */
export interface KontorContext {
  chain: Chain;
  indexerUrl: string;
  btcNetwork: btc.Network;
}
