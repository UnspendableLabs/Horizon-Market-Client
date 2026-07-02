import type {
  PreparedSend,
  SendDeps,
  SendRequest,
  SendResult,
} from "./types.js";
import { prepareBtc } from "./btc.js";
import { prepareCounterparty } from "./counterparty.js";
import { prepareZeld } from "./zeld.js";
import { prepareOrdinal } from "./ordinal.js";
import { prepareKontorToken, prepareKontorNft } from "./kontor.js";

export type {
  SendRequest,
  SendResult,
  SendDeps,
  SendKind,
  SendNetwork,
  PreparedSend,
} from "./types.js";

/**
 * Unified send/withdraw dispatcher: composes, funds and signs a transfer for any
 * supported asset type, returning a {@link PreparedSend} whose `feeSats` is the
 * exact miner fee (null for Kontor). The transaction is *not* broadcast — call
 * {@link PreparedSend.broadcast} to publish it. This two-phase split lets the
 * review UI show the exact fee before the user commits.
 *
 * Each branch delegates to its family composer:
 * - `btc` / `ordinal` — local bitcoinjs PSBT over mempool.space
 * - `counterparty` (incl. XCP) — counterparty-core compose → sign
 * - `zeld` — local bitcoinjs PSBT with a ZELD OP_RETURN distribution
 * - `kor` / `kontor-nft` — `@kontor/sdk` contract transfer (composed at submit)
 */
export function prepareSend(
  request: SendRequest,
  deps: SendDeps,
): Promise<PreparedSend> {
  switch (request.kind) {
    case "btc":
      return prepareBtc(
        {
          toAddress: request.toAddress,
          amountSats: request.amountSats,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    case "counterparty":
      return prepareCounterparty(
        {
          fromAddress: request.fromAddress,
          asset: request.asset,
          toAddress: request.toAddress,
          quantity: request.quantity,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    case "zeld":
      return prepareZeld(
        {
          fromAddress: request.fromAddress,
          toAddress: request.toAddress,
          amount: request.amount,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    case "ordinal":
      return prepareOrdinal(
        {
          fromAddress: request.fromAddress,
          utxoId: request.utxoId,
          toAddress: request.toAddress,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    case "kor":
      return Promise.resolve(
        prepareKontorToken(
          {
            toAddress: request.toAddress,
            amount: request.amount,
            satsPerVbyte: request.satsPerVbyte,
          },
          deps,
        ),
      );
    case "kontor-nft":
      return Promise.resolve(
        prepareKontorNft(
          {
            contractAddress: request.contractAddress,
            nftId: request.nftId,
            toAddress: request.toAddress,
            satsPerVbyte: request.satsPerVbyte,
          },
          deps,
        ),
      );
  }
}

/**
 * Compose, sign and broadcast a transfer in one shot (prepare → broadcast).
 * Convenience wrapper over {@link prepareSend} for callers that don't need to
 * surface the fee first.
 */
export async function sendAsset(
  request: SendRequest,
  deps: SendDeps,
): Promise<SendResult> {
  return (await prepareSend(request, deps)).broadcast();
}
