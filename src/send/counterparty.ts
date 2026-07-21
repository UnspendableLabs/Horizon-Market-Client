import * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { PreparedSend, SendDeps, SendResult } from "./types.js";
import {
  broadcastRawTx,
  fetchPrevOutput,
  fetchRawTxHex,
  mempoolApiBase,
} from "./bitcoin.js";

export interface SendCounterpartyParams {
  fromAddress: string;
  asset: string;
  toAddress: string;
  /** Base units: divisible → sats (×1e8), indivisible → whole count. */
  quantity: bigint;
  satsPerVbyte: number;
}

interface ComposeResult {
  psbt?: unknown;
  rawtransaction?: unknown;
}

/** A witness program script (v0/v1): OP_0/OP_1 + a single data push. */
function isWitnessScript(script: Uint8Array): boolean {
  if (script.length < 4) return false;
  const version = script[0];
  const isVersionByte = version === 0x00 || (version >= 0x51 && version <= 0x60);
  return isVersionByte && script[1] === script.length - 2;
}

/**
 * Compose a Counterparty send (XCP or any named asset), returning a
 * {@link PreparedSend} with the exact miner fee — built but not yet signed or
 * broadcast. {@link PreparedSend.broadcast} signs (prompting the wallet) then
 * publishes, so the signature is requested at confirm time, not review time.
 *
 * counterparty-core composes the transaction (input selection + the send's
 * OP_RETURN/data outputs) and returns a PSBT; every input is one of the source
 * address's own UTXOs. We backfill each input's prevout (mempool) so bitcoinjs
 * can sign later. The fee is read back off the composed PSBT as
 * `Σ inputs − Σ outputs` — known without signing.
 */
export async function prepareCounterparty(
  params: SendCounterpartyParams,
  deps: SendDeps,
): Promise<PreparedSend> {
  const { signer, fetch, network, btcNetwork, kontorNetwork } = deps;
  const { fromAddress, asset, toAddress, quantity, satsPerVbyte } = params;

  if (!deps.counterpartyApiBaseUrl) {
    throw new Error("Counterparty sends require a configured counterpartyApiBaseUrl");
  }
  if (quantity <= 0n) throw new Error("Quantity must be greater than 0");
  if (satsPerVbyte <= 0) throw new Error("Fee rate must be greater than 0");

  const cpRoot = deps.counterpartyApiBaseUrl.replace(/\/$/, "");
  const base = mempoolApiBase(network, kontorNetwork);
  const { publicKey } = signer.getAddresses();

  // ---- compose via counterparty-core (it selects inputs, asset-aware) ----
  const query = new URLSearchParams({
    destination: toAddress,
    asset,
    quantity: quantity.toString(),
    sat_per_vbyte: satsPerVbyte.toString(),
    pubkeys: publicKey,
    verbose: "true",
  });
  const url = `${cpRoot}/v2/addresses/${encodeURIComponent(fromAddress)}/compose/send?${query.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* keep statusText */
    }
    throw new Error(`Counterparty compose returned ${res.status}: ${detail}`);
  }
  const body = (await res.json()) as { result?: ComposeResult; error?: unknown };
  const result = body.result;
  const psbtB64 =
    result && typeof result.psbt === "string" ? result.psbt : null;
  if (!psbtB64) {
    throw new Error(
      "Counterparty compose did not return a PSBT (needs a counterparty-core that supports verbose PSBT compose)",
    );
  }

  // ---- backfill each input's prevout so bitcoinjs can sign ----
  const psbt = btc.Psbt.fromBase64(psbtB64, { network: btcNetwork });
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo || input.nonWitnessUtxo) continue;
    const txInput = psbt.txInputs[i];
    const prevTxid = Buffer.from(txInput.hash).reverse().toString("hex");
    const prev = await fetchPrevOutput(fetch, base, prevTxid, txInput.index);
    const script = Buffer.from(prev.scriptPubKeyHex, "hex");
    if (isWitnessScript(script)) {
      psbt.updateInput(i, { witnessUtxo: { script, value: prev.value } });
    } else {
      const rawHex = await fetchRawTxHex(fetch, base, prevTxid);
      psbt.updateInput(i, { nonWitnessUtxo: Buffer.from(rawHex, "hex") });
    }
  }

  // Exact miner fee = Σ input values − Σ output values. After the backfill above
  // every input carries a witnessUtxo (segwit) or nonWitnessUtxo (legacy) we can
  // read the spent value from.
  let totalIn = 0n;
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];
    if (input.witnessUtxo) {
      totalIn += input.witnessUtxo.value;
    } else if (input.nonWitnessUtxo) {
      const prevTx = btc.Transaction.fromBuffer(input.nonWitnessUtxo);
      totalIn += prevTx.outs[psbt.txInputs[i].index].value;
    }
  }
  const totalOut = psbt.txOutputs.reduce((sum, o) => sum + o.value, 0n);
  const feeSats = totalIn - totalOut;

  const unsignedHex = psbt.toHex();
  const inputIndices = psbt.data.inputs.map((_, i) => i);
  return {
    kind: "counterparty",
    feeSats,
    // Sign at broadcast time (not here) so the wallet prompt fires on confirm.
    // `feeSats` above is already exact — read off the composed PSBT, no
    // signature needed.
    broadcast: async () => {
      const signedHex = await signer.signPsbtHex(unsignedHex, inputIndices);
      const { txHex, txId } = finalizePsbtHex(signedHex, btcNetwork);
      await broadcastRawTx(fetch, base, txHex);
      return { txid: txId };
    },
  };
}

/** Compose, sign and broadcast a Counterparty send in one shot. */
export async function sendCounterparty(
  params: SendCounterpartyParams,
  deps: SendDeps,
): Promise<SendResult> {
  return (await prepareCounterparty(params, deps)).broadcast();
}
