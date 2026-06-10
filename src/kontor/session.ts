import { KontorSession, HttpTransport } from "@kontor/sdk";
import type { Chain, Signing } from "@kontor/sdk";

type FundingSource = ConstructorParameters<typeof HttpTransport>[0]["funding"];

export interface MakeKontorSessionArgs {
  chain: Chain;
  signing: Signing;
  funding: FundingSource;
  /** Kontor indexer URL the transport submits signed transactions to. */
  indexerUrl: string;
  /** Optional sat/vByte fee rate for composed on-chain transactions. */
  feeRate?: number;
}

/**
 * Build a signing-capable KontorSession + HttpTransport.
 *
 * Ported from the Horizon-Market server's `makeKontorSession`, with the indexer
 * URL injected (Node default = direct Kontor signet indexer) and the `signing`
 * supplied by the caller (derived from the client's LocalSigner — the private
 * key stays in-process). The transport signs locally and broadcasts only signed
 * transactions.
 */
export function makeKontorSession(args: MakeKontorSessionArgs): KontorSession {
  const { chain, signing, funding, indexerUrl, feeRate } = args;

  return new KontorSession({
    chain,
    signing,
    feeRate: feeRate ?? undefined,
    transport: ({ chain: c, identity, signing: s, feeRate: fr }) =>
      new HttpTransport({
        chain: c,
        identity,
        signing: s,
        feeRate: fr ?? undefined,
        funding,
        url: indexerUrl,
      }),
  });
}
