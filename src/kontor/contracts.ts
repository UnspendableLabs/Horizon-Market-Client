import * as btc from "bitcoinjs-lib";
import { Decimal } from "@kontor/sdk";
import type { KontorSession } from "@kontor/sdk";
import { Contract as Token } from "./__generated__/token.js";
import { Contract as Nft } from "./__generated__/nft.js";
import { nativeTokenContractAddress } from "./chain.js";

export { Decimal };

/** Bind the native KOR token contract on the given session. */
export function bindKontorToken(session: KontorSession): Token {
  return session.bind(Token, nativeTokenContractAddress(session.chain));
}

/** Bind an NFT contract at `contractAddress` (human `name@height.txIndex` form). */
export function bindKontorNft(
  session: KontorSession,
  contractAddress: string,
): Nft {
  return session.bind(Nft, contractAddress);
}

/** The escrowed asset UTXO (output 0 of the attach reveal). */
export interface AttachRevealEscrow {
  /** Attach-reveal txid. */
  txid: string;
  /** Value (sats) of output 0 — the escrowed asset UTXO. */
  value: number;
}

/**
 * Parse an OfferData blob (JSON) and return the attach-reveal escrow outpoint.
 * The escrow is always output 0 of the attach reveal, so `asset_utxo_id =
 * `${txid}:0`` and `asset_utxo_value` is the value of that output.
 *
 * Uses bitcoinjs-lib for pure deserialization (no script validation), so it
 * accepts the SDK's taproot/OP_RETURN attach reveal as-is.
 */
export function attachRevealEscrowFromBlob(blob: string): AttachRevealEscrow {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(blob);
  } catch {
    throw new Error("kontor offer blob is not valid JSON");
  }
  if (data.v !== 1) {
    throw new Error(`unsupported kontor offer blob version ${String(data.v)}`);
  }
  const attachReveal = data.attachReveal;
  if (typeof attachReveal !== "string" || attachReveal.length === 0) {
    throw new Error("kontor offer blob is missing attachReveal");
  }
  const tx = btc.Transaction.fromHex(attachReveal);
  if (tx.outs.length === 0) {
    throw new Error("kontor attach reveal has no escrow output");
  }
  // bitcoinjs-lib v7 exposes output values as bigint; the API wire uses number.
  return { txid: tx.getId(), value: Number(tx.outs[0].value) };
}

/** Attach-reveal txid (escrow is output 0, so `asset_utxo_id = `${txid}:0``). */
export function attachRevealTxidFromBlob(blob: string): string {
  return attachRevealEscrowFromBlob(blob).txid;
}
