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
  type SpendableUtxo,
} from "./bitcoin.js";

export interface SendBtcParams {
  toAddress: string;
  amountSats: bigint;
  satsPerVbyte: number;
}

/** A funding UTXO tagged with the signer address that holds it. */
interface FundingUtxo extends SpendableUtxo {
  address: string;
}

/**
 * Compose and fund a plain BTC send, returning a {@link PreparedSend} whose
 * `feeSats` is the exact miner fee. The transaction is built but not yet signed
 * or broadcast — {@link PreparedSend.broadcast} signs it (prompting the wallet)
 * then publishes, so the signature is requested when the user confirms, not
 * when they open the review screen.
 *
 * Funds from the signer's own P2WPKH + P2TR confirmed UTXOs (asset-bearing /
 * inscription UTXOs excluded via `deps.protectedUtxoIds`), greedily selected
 * largest-first. Change returns to the P2WPKH address.
 */
export async function prepareBtc(
  params: SendBtcParams,
  deps: SendDeps,
): Promise<PreparedSend> {
  const { signer, fetch, network, btcNetwork, kontorNetwork } = deps;
  const { toAddress, amountSats, satsPerVbyte } = params;

  if (amountSats <= 0n) throw new Error("Amount must be greater than 0");
  if (amountSats < BTC_DUST_SATS) {
    throw new Error(`Amount is below the dust limit (${BTC_DUST_SATS} sats)`);
  }
  if (satsPerVbyte <= 0) throw new Error("Fee rate must be greater than 0");

  const addresses = signer.getAddresses();
  const changeAddress = addresses.p2wpkh;
  const sourceAddresses = [
    addresses.p2wpkh,
    ...(addresses.p2tr ? [addresses.p2tr] : []),
  ];
  const base = mempoolApiBase(network, kontorNetwork);
  const protectedIds = new Set(deps.protectedUtxoIds ?? []);

  const perAddress = await Promise.all(
    sourceAddresses.map(async (address) => {
      const utxos = await fetchConfirmedUtxos(fetch, base, address, protectedIds);
      return utxos.map((u): FundingUtxo => ({ ...u, address }));
    }),
  );
  const candidates = perAddress
    .flat()
    .sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));

  const destVsize = outputVsizeForAddress(toAddress, btcNetwork);
  const changeVsize = outputVsizeForAddress(changeAddress, btcNetwork);
  const feeFor = (inputVsizeSum: number, withChange: boolean): bigint =>
    feeForVsize(
      TX_OVERHEAD_VSIZE +
        inputVsizeSum +
        destVsize +
        (withChange ? changeVsize : 0),
      satsPerVbyte,
    );

  const chosen: FundingUtxo[] = [];
  let totalIn = 0n;
  let inputVsizeSum = 0;
  for (const u of candidates) {
    chosen.push(u);
    totalIn += u.value;
    inputVsizeSum += inputVsizeForAddress(u.address, btcNetwork);
    if (totalIn >= amountSats + feeFor(inputVsizeSum, true)) break;
  }

  const feeWithChange = feeFor(inputVsizeSum, true);
  const feeNoChange = feeFor(inputVsizeSum, false);
  let change = totalIn - amountSats - feeWithChange;
  const includeChange = change >= BTC_DUST_SATS;
  if (!includeChange) {
    if (totalIn < amountSats + feeNoChange) {
      throw new Error("Insufficient BTC balance to cover the amount and fee");
    }
    change = 0n;
  }

  const psbt = new btc.Psbt({ network: btcNetwork });
  for (const u of chosen) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: {
        script: btc.address.toOutputScript(u.address, btcNetwork),
        value: u.value,
      },
    });
  }
  psbt.addOutput({ address: toAddress, value: amountSats });
  if (includeChange) {
    psbt.addOutput({ address: changeAddress, value: change });
  }

  const unsignedHex = psbt.toHex();
  const inputIndices = chosen.map((_, i) => i);
  const feeSats = totalIn - amountSats - change;
  return {
    kind: "btc",
    feeSats,
    // Sign at broadcast time (not here) so the wallet prompt fires when the user
    // confirms. `feeSats` above is already exact — it comes from UTXO selection,
    // independent of the signature.
    broadcast: async () => {
      const signedHex = await signer.signPsbtHex(unsignedHex, inputIndices);
      const { txHex, txId } = finalizePsbtHex(signedHex, btcNetwork);
      await broadcastRawTx(fetch, base, txHex);
      return { txid: txId };
    },
  };
}

/** Compose, sign and broadcast a plain BTC send in one shot. */
export async function sendBtc(
  params: SendBtcParams,
  deps: SendDeps,
): Promise<SendResult> {
  return (await prepareBtc(params, deps)).broadcast();
}
