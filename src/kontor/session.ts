import { KontorSession, HttpTransport, Identity } from "@kontor/sdk";
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

export interface MakeKontorReadSessionArgs {
  chain: Chain;
  /** Taproot x-only pubkey (64 hex chars) of the wallet to read balances for. */
  xOnlyPubkey: string;
  /** Kontor indexer URL the read-only `view` calls hit. */
  indexerUrl: string;
  /** `fetch` for the session's poller (injected for tests / custom runtimes). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Build a read-only KontorSession — no signing/funding, so only `view` calls
 * (balance, listNftsByHolder…) work; `submit`/`inspect`/`simulate` throw.
 *
 * Ported from the Horizon-Market server's `makeKontorReadSession`: the identity
 * is derived from the wallet's taproot x-only pubkey via `Identity.fromXOnly`,
 * and the transport points at the configured indexer URL.
 */
export function makeKontorReadSession(
  args: MakeKontorReadSessionArgs,
): KontorSession {
  const { chain, xOnlyPubkey, indexerUrl, fetch: fetchImpl } = args;
  const identity = Identity.fromXOnly(xOnlyPubkey, chain);
  return new KontorSession({
    chain,
    identity,
    fetch: fetchImpl,
    transport: ({ chain: c, identity: id }) =>
      new HttpTransport({ chain: c, identity: id, url: indexerUrl }),
  });
}
