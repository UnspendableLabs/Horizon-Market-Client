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
import { assertKontorRuntime } from "../kontor/runtime.js";

export type {
  SendRequest,
  SendResult,
  SendDeps,
  SendKind,
  SendNetwork,
  PreparedSend,
} from "./types.js";

/**
 * Unified send/withdraw dispatcher: composes and funds a transfer for any
 * supported asset type, returning a {@link PreparedSend} whose `feeSats` is the
 * exact miner fee (null for Kontor). The transaction is *not* signed or
 * broadcast — call {@link PreparedSend.broadcast} to sign (prompting the wallet)
 * then publish it. This two-phase split lets the review UI show the exact fee
 * before the user commits, with the wallet prompt firing only on confirm.
 *
 * Each branch delegates to its family composer:
 * - `btc` / `ordinal` — local bitcoinjs PSBT over mempool.space
 * - `counterparty` (incl. XCP) — counterparty-core compose (signed at broadcast)
 * - `zeld` — local bitcoinjs PSBT with a ZELD OP_RETURN distribution
 * - `kor` / `kontor-nft` — `@kontor/sdk` contract transfer (composed at submit)
 *
 * The Kontor branches load `./kontor.js` (and its `@kontor/sdk` dependency) via
 * dynamic `import()` so this module — and the withdraw path that uses it — never
 * evaluates a Kontor backend (WASM or native) at startup.
 */
export async function prepareSend(
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
    case "kor": {
      assertKontorRuntime();
      const { prepareKontorToken } = await import("./kontor.js");
      return prepareKontorToken(
        {
          toAddress: request.toAddress,
          amount: request.amount,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    }
    case "kontor-nft": {
      assertKontorRuntime();
      const { prepareKontorNft } = await import("./kontor.js");
      return prepareKontorNft(
        {
          contractAddress: request.contractAddress,
          nftId: request.nftId,
          toAddress: request.toAddress,
          satsPerVbyte: request.satsPerVbyte,
        },
        deps,
      );
    }
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
