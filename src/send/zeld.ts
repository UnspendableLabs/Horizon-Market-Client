import * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { PreparedSend, SendDeps, SendResult } from "./types.js";
import {
  BTC_DUST_SATS,
  TX_OVERHEAD_VSIZE,
  broadcastRawTx,
  feeForVsize,
  fetchConfirmedUtxos,
  inputVsizeForAddress,
  mempoolApiBase,
  outputVsizeForAddress,
} from "./bitcoin.js";
import { buildZeldOpReturnScript } from "./zeld-opreturn.js";

export interface SendZeldParams {
  fromAddress: string;
  toAddress: string;
  /** ZELD base units (8 decimals). */
  amount: bigint;
  satsPerVbyte: number;
}

/** Each ZELD output carries this many sats (matches Horizon's DUST_OUTPUT_SATS). */
const ZELD_DUST_SATS = 330n;

/** Conservative vsize for the ZELD OP_RETURN output (payload ≤ 80 B). */
const OP_RETURN_VSIZE = 50;

interface ZeldUtxoWire {
  balance?: unknown;
  txid?: unknown;
  vout?: unknown;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return BigInt(value.trim());
  return 0n;
}

/**
 * Compose, fund and sign a ZELD transfer, returning a {@link PreparedSend} with
 * the exact miner fee — built but not yet broadcast.
 *
 * Port of Horizon Market's `composeZeldTransferForSwap` as a plain send: no WASM
 * miner is needed for a transfer — ZELD moves via an OP_RETURN `"ZELD"` + CBOR
 * distribution. Output order (distribution maps to non-OP_RETURN outputs in
 * order): `[0: recipient (330 sats, =amount), 1: ZELD change→sender (if any),
 * BTC change→sender (if any), OP_RETURN]`.
 */
export async function prepareZeld(
  params: SendZeldParams,
  deps: SendDeps,
): Promise<PreparedSend> {
  const { signer, fetch, network, btcNetwork, kontorNetwork, zeldApiBaseUrl } =
    deps;
  const { fromAddress, toAddress, amount, satsPerVbyte } = params;

  if (!zeldApiBaseUrl) {
    throw new Error("ZELD sends require a configured zeldApiBaseUrl (mainnet)");
  }
  if (amount <= 0n) throw new Error("ZELD amount must be greater than 0");
  if (satsPerVbyte <= 0) throw new Error("Fee rate must be greater than 0");

  const base = mempoolApiBase(network, kontorNetwork);
  const zeldRoot = zeldApiBaseUrl.replace(/\/$/, "");

  // ---- ZELD-bearing UTXOs (from the ZeldHash indexer), largest balance first ----
  const zeldRes = await fetch(
    `${zeldRoot}/addresses/${encodeURIComponent(fromAddress)}/utxos`,
    { headers: { Accept: "application/json" } },
  );
  if (!zeldRes.ok) {
    throw new Error(`ZeldHash API returned ${zeldRes.status}: ${zeldRes.statusText}`);
  }
  const zeldRaw = (await zeldRes.json()) as unknown;
  const zeldRows = Array.isArray(zeldRaw) ? (zeldRaw as ZeldUtxoWire[]) : [];
  const zeldBearing = zeldRows
    .map((r) => ({
      txid: typeof r.txid === "string" ? r.txid : "",
      vout: typeof r.vout === "number" ? r.vout : -1,
      balance: toBigInt(r.balance),
    }))
    .filter((u) => u.txid !== "" && u.vout >= 0 && u.balance > 0n)
    .sort((a, b) => (a.balance < b.balance ? 1 : a.balance > b.balance ? -1 : 0));

  // ---- confirmed sats-values for every UTXO on the address (from mempool) ----
  const protectedIds = new Set(deps.protectedUtxoIds ?? []);
  const zeldIds = new Set(zeldBearing.map((u) => `${u.txid}:${u.vout}`));
  const mempoolUtxos = await fetchConfirmedUtxos(fetch, base, fromAddress);
  const valueById = new Map(
    mempoolUtxos.map((u) => [`${u.txid}:${u.vout}`, u.value] as const),
  );

  // ---- select ZELD inputs to cover `amount` ----
  const zeldInputs: { txid: string; vout: number; value: bigint }[] = [];
  let totalZeld = 0n;
  for (const u of zeldBearing) {
    const value = valueById.get(`${u.txid}:${u.vout}`);
    if (value === undefined) continue; // unconfirmed / spent — skip
    zeldInputs.push({ txid: u.txid, vout: u.vout, value });
    totalZeld += u.balance;
    if (totalZeld >= amount) break;
  }
  if (totalZeld < amount) {
    throw new Error(
      `Insufficient ZELD balance. Have ${totalZeld}, need ${amount}`,
    );
  }
  const zeldChange = totalZeld - amount;

  // ---- pure-BTC funding candidates (exclude every ZELD + protected UTXO) ----
  const fundingCandidates = mempoolUtxos.filter(
    (u) =>
      !zeldIds.has(`${u.txid}:${u.vout}`) &&
      !protectedIds.has(`${u.txid}:${u.vout}`),
  );

  // ---- fixed (non-change) output cost & vsize scaffolding ----
  const swapValue = ZELD_DUST_SATS; // recipient output
  const zeldChangeValue = zeldChange > 0n ? ZELD_DUST_SATS : 0n;
  const fixedOut = swapValue + zeldChangeValue;

  const perInput = inputVsizeForAddress(fromAddress, btcNetwork);
  const destVsize = outputVsizeForAddress(toAddress, btcNetwork);
  const changeVsize = outputVsizeForAddress(fromAddress, btcNetwork);
  const baseOutVsize =
    destVsize + (zeldChange > 0n ? changeVsize : 0) + OP_RETURN_VSIZE;
  const feeFor = (numInputs: number, withBtcChange: boolean): bigint =>
    feeForVsize(
      TX_OVERHEAD_VSIZE +
        numInputs * perInput +
        baseOutVsize +
        (withBtcChange ? changeVsize : 0),
      satsPerVbyte,
    );

  // ---- coin selection: ZELD inputs mandatory; add BTC until covered ----
  const chosen = [...zeldInputs];
  let totalIn = zeldInputs.reduce((s, i) => s + i.value, 0n);
  for (const u of fundingCandidates) {
    if (totalIn >= fixedOut + feeFor(chosen.length, true)) break;
    chosen.push(u);
    totalIn += u.value;
  }

  const feeWithChange = feeFor(chosen.length, true);
  const feeNoChange = feeFor(chosen.length, false);
  let btcChange = totalIn - fixedOut - feeWithChange;
  const includeBtcChange = btcChange >= BTC_DUST_SATS;
  if (!includeBtcChange) {
    if (totalIn < fixedOut + feeNoChange) {
      throw new Error("Insufficient BTC funds to compose the ZELD transfer");
    }
    btcChange = 0n;
  }

  // ---- build the PSBT ----
  const psbt = new btc.Psbt({ network: btcNetwork });
  const fromScript = btc.address.toOutputScript(fromAddress, btcNetwork);
  for (const u of chosen) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: fromScript, value: u.value },
    });
  }

  const distribution: bigint[] = [amount];
  psbt.addOutput({ address: toAddress, value: swapValue }); // out 0: recipient
  if (zeldChange > 0n) {
    psbt.addOutput({ address: fromAddress, value: zeldChangeValue });
    distribution.push(zeldChange);
  }
  if (includeBtcChange) {
    psbt.addOutput({ address: fromAddress, value: btcChange });
    distribution.push(0n);
  }
  psbt.addOutput({ script: buildZeldOpReturnScript(distribution), value: 0n });

  const signedHex = signer.signPsbtHex(
    psbt.toHex(),
    chosen.map((_, i) => i),
  );
  const { txHex, txId } = finalizePsbtHex(signedHex, btcNetwork);
  // Every output value (recipient dust, ZELD change, BTC change; OP_RETURN is 0)
  // is known, so the miner fee is exactly inputs − outputs.
  const totalOut = swapValue + zeldChangeValue + btcChange;
  const feeSats = totalIn - totalOut;
  return {
    kind: "zeld",
    feeSats,
    broadcast: async () => {
      await broadcastRawTx(fetch, base, txHex);
      return { txid: txId };
    },
  };
}

/** Compose, sign and broadcast a ZELD transfer in one shot. */
export async function sendZeld(
  params: SendZeldParams,
  deps: SendDeps,
): Promise<SendResult> {
  return (await prepareZeld(params, deps)).broadcast();
}
