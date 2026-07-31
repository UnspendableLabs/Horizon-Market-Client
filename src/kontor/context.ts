import type { Chain } from "@kontor/sdk";
import type * as btc from "bitcoinjs-lib";

/**
 * Resolved Kontor runtime context, built once by the client and passed into the
 * Kontor workflows. Carries no secrets — only the chain, indexer URL, the
 * bitcoin network used to derive funding scriptPubKeys, and the client's
 * `fetch`.
 */
export interface KontorContext {
  chain: Chain;
  indexerUrl: string;
  btcNetwork: btc.Network;
  /**
   * The client's resolved `fetch`, for the indexer reads the workflows make
   * outside the Kontor SDK's own transport — today the pre-flight's
   * `/signers/{x-only}` lookup.
   *
   * Threaded rather than defaulted to `globalThis.fetch` because a host that
   * supplied its own (a proxy, a React Native polyfill, an instrumented
   * `fetch`) has already had it honoured by every other read on this client:
   * a pre-flight that quietly bypassed it would fail to reach an indexer the
   * rest of the SDK reaches fine, and a failed *lookup* throws — so the check
   * would block the very flow it exists to protect.
   */
  fetch: typeof globalThis.fetch;
}
