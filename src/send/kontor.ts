import { HolderRef } from "@kontor/sdk";
import { makeKontorSession } from "../kontor/session.js";
import { resolveKontorFunding } from "../kontor/funding.js";
import { getKontorSigning } from "../kontor/signing.js";
import { bindKontorToken, bindKontorNft, Decimal } from "../kontor/contracts.js";
import { xOnlyFromTaprootAddress } from "../kontor/holders.js";
import type { KontorContext } from "../kontor/context.js";
import type { PreparedSend, SendDeps, SendResult } from "./types.js";

export interface SendKontorTokenParams {
  /** Recipient P2TR address; the holder ref is derived from it. */
  toAddress: string;
  /** KOR amount as a decimal string (e.g. "100.5"). */
  amount: string;
  satsPerVbyte?: number;
}

export interface SendKontorNftParams {
  contractAddress: string;
  nftId: string;
  /** Recipient P2TR address; the holder ref is derived from it. */
  toAddress: string;
  satsPerVbyte?: number;
}

/**
 * Resolve the recipient holder ref from a P2TR address.
 *
 * Per the wallet convention, a Kontor recipient is addressed by their taproot
 * (P2TR) address; the holder ref is its bech32m-tweaked x-only output key — the
 * same candidate the client already reads balances against (see
 * `kontor/holders.ts`).
 */
function recipientHolder(toAddress: string): HolderRef {
  const xOnly = xOnlyFromTaprootAddress(toAddress);
  if (!xOnly) {
    throw new Error("Kontor recipient must be a taproot (P2TR) address");
  }
  return HolderRef.xOnlyPubkey(xOnly);
}

function requireKontorCtx(deps: SendDeps): KontorContext {
  if (!deps.kontorCtx) {
    throw new Error(
      'Kontor sends require kontorNetwork: "signet" and network: "testnet"',
    );
  }
  return deps.kontorCtx;
}

/**
 * Prepare a KOR (native Kontor token) transfer. The `@kontor/sdk` composes,
 * signs and broadcasts atomically at `.submit()`, so there is nothing to
 * pre-compose: `feeSats` is `null` (the SDK sets the fee at submit) and
 * `broadcast()` performs the whole transfer.
 */
export function prepareKontorToken(
  params: SendKontorTokenParams,
  deps: SendDeps,
): PreparedSend {
  return {
    kind: "kor",
    feeSats: null,
    broadcast: () => sendKontorToken(params, deps),
  };
}

/** Compose, sign and broadcast a KOR (native Kontor token) transfer via the SDK. */
export async function sendKontorToken(
  params: SendKontorTokenParams,
  deps: SendDeps,
): Promise<SendResult> {
  const ctx = requireKontorCtx(deps);
  if (!params.amount) throw new Error("KOR amount is required");
  const dst = recipientHolder(params.toAddress);

  const taproot = deps.signer.getAddresses().p2tr;
  if (!taproot) {
    throw new Error("Kontor sends require a P2TR address on the signer");
  }

  const signing = await getKontorSigning(deps.signer, ctx.chain);
  const funding = resolveKontorFunding(deps.http, taproot, ctx.btcNetwork, undefined);
  const session = makeKontorSession({
    chain: ctx.chain,
    signing,
    funding,
    indexerUrl: ctx.indexerUrl,
    feeRate: params.satsPerVbyte,
  });

  try {
    const submitted = await bindKontorToken(session)
      .transfer(dst, Decimal.from(params.amount))
      .submit();
    return { txid: submitted.txid };
  } finally {
    session.close();
  }
}

/**
 * Prepare a Kontor NFT transfer. Like {@link prepareKontorToken}, the SDK
 * submits atomically, so `feeSats` is `null` and `broadcast()` runs the whole
 * transfer.
 */
export function prepareKontorNft(
  params: SendKontorNftParams,
  deps: SendDeps,
): PreparedSend {
  return {
    kind: "kontor-nft",
    feeSats: null,
    broadcast: () => sendKontorNft(params, deps),
  };
}

/** Compose, sign and broadcast a Kontor NFT transfer via the SDK. */
export async function sendKontorNft(
  params: SendKontorNftParams,
  deps: SendDeps,
): Promise<SendResult> {
  const ctx = requireKontorCtx(deps);
  if (!params.nftId) throw new Error("nftId is required");
  if (!params.contractAddress) throw new Error("contractAddress is required");
  const dst = recipientHolder(params.toAddress);

  const taproot = deps.signer.getAddresses().p2tr;
  if (!taproot) {
    throw new Error("Kontor sends require a P2TR address on the signer");
  }

  const signing = await getKontorSigning(deps.signer, ctx.chain);
  const funding = resolveKontorFunding(deps.http, taproot, ctx.btcNetwork, undefined);
  const session = makeKontorSession({
    chain: ctx.chain,
    signing,
    funding,
    indexerUrl: ctx.indexerUrl,
    feeRate: params.satsPerVbyte,
  });

  try {
    const submitted = await bindKontorNft(session, params.contractAddress)
      .transfer(params.nftId, dst)
      .submit();
    return { txid: submitted.txid };
  } finally {
    session.close();
  }
}
