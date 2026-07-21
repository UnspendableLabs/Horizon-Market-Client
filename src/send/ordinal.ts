import * as btc from "bitcoinjs-lib";
import { finalizePsbtHex } from "../crypto/psbt-signer.js";
import type { PreparedSend, SendDeps, SendResult } from "./types.js";
import {
  BTC_DUST_SATS,
  TX_OVERHEAD_VSIZE,
  broadcastRawTx,
  feeForVsize,
  fetchConfirmedUtxos,
  fetchPrevOutput,
  inputVsizeForAddress,
  mempoolApiBase,
  outputVsizeForAddress,
  witnessInput,
  type SpendableUtxo,
} from "./bitcoin.js";

export interface SendOrdinalParams {
  /** Address currently holding the inscription UTXO. */
  fromAddress: string;
  /** Inscription holding UTXO id (`txid:vout`). */
  utxoId: string;
  toAddress: string;
  satsPerVbyte: number;
}

interface FundingUtxo extends SpendableUtxo {
  address: string;
}

/**
 * Compose, fund and sign an ordinal (inscription) transfer, returning a
 * {@link PreparedSend} with the exact miner fee — built but not yet broadcast.
 *
 * The inscription is input 0 and its full value is paid to `toAddress` as output
 * 0, so the inscribed sat's offset is preserved. The fee is paid from separate
 * plain-BTC funding UTXOs (never the inscription itself or any protected UTXO),
 * with change back to the signer's P2WPKH address.
 */
export async function prepareOrdinal(
  params: SendOrdinalParams,
  deps: SendDeps,
): Promise<PreparedSend> {
  const { signer, fetch, network, btcNetwork, kontorNetwork } = deps;
  const { fromAddress, utxoId, toAddress, satsPerVbyte } = params;

  if (satsPerVbyte <= 0) throw new Error("Fee rate must be greater than 0");
  const [insTxid, insVoutStr] = utxoId.split(":");
  const insVout = Number(insVoutStr);
  if (!insTxid || !Number.isInteger(insVout) || insVout < 0) {
    throw new Error(`Invalid inscription utxo id: ${utxoId}`);
  }

  const base = mempoolApiBase(network, kontorNetwork);
  const addresses = signer.getAddresses();
  const changeAddress = addresses.p2wpkh;

  // Never spend the inscription (or any other protected UTXO) as fee funding.
  const protectedIds = new Set(deps.protectedUtxoIds ?? []);
  protectedIds.add(utxoId);

  const inscriptionPrev = await fetchPrevOutput(fetch, base, insTxid, insVout);
  const inscriptionValue = inscriptionPrev.value;

  const fundingAddresses = [
    addresses.p2wpkh,
    ...(addresses.p2tr ? [addresses.p2tr] : []),
  ];
  const perAddress = await Promise.all(
    fundingAddresses.map(async (address) => {
      const utxos = await fetchConfirmedUtxos(fetch, base, address, protectedIds);
      return utxos.map((u): FundingUtxo => ({ ...u, address }));
    }),
  );
  const fundingCandidates = perAddress
    .flat()
    .sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));

  const inscriptionInVsize = inputVsizeForAddress(fromAddress, btcNetwork);
  const destVsize = outputVsizeForAddress(toAddress, btcNetwork);
  const changeVsize = outputVsizeForAddress(changeAddress, btcNetwork);
  const feeFor = (fundingVsizeSum: number, withChange: boolean): bigint =>
    feeForVsize(
      TX_OVERHEAD_VSIZE +
        inscriptionInVsize +
        fundingVsizeSum +
        destVsize +
        (withChange ? changeVsize : 0),
      satsPerVbyte,
    );

  const chosen: FundingUtxo[] = [];
  let totalFunding = 0n;
  let fundingVsizeSum = 0;
  for (const u of fundingCandidates) {
    if (totalFunding >= feeFor(fundingVsizeSum, true)) break;
    chosen.push(u);
    totalFunding += u.value;
    fundingVsizeSum += inputVsizeForAddress(u.address, btcNetwork);
  }

  const feeWithChange = feeFor(fundingVsizeSum, true);
  const feeNoChange = feeFor(fundingVsizeSum, false);
  let change = totalFunding - feeWithChange;
  const includeChange = change >= BTC_DUST_SATS;
  if (!includeChange) {
    if (totalFunding < feeNoChange) {
      throw new Error("Insufficient BTC balance to cover the inscription transfer fee");
    }
    change = 0n;
  }

  const psbt = new btc.Psbt({ network: btcNetwork });
  // Input 0: the inscription UTXO (keeps the inscribed sat at output 0 offset 0).
  psbt.addInput(witnessInput(insTxid, insVout, inscriptionPrev));
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
  psbt.addOutput({ address: toAddress, value: inscriptionValue }); // out 0
  if (includeChange) {
    psbt.addOutput({ address: changeAddress, value: change });
  }

  const inputCount = 1 + chosen.length;
  const signedHex = await signer.signPsbtHex(
    psbt.toHex(),
    Array.from({ length: inputCount }, (_, i) => i),
  );
  const { txHex, txId } = finalizePsbtHex(signedHex, btcNetwork);
  // Inscription value passes straight through (in 0 → out 0); the fee is funded
  // entirely from the plain-BTC inputs, so it's exactly funding − change.
  const feeSats = totalFunding - change;
  return {
    kind: "ordinal",
    feeSats,
    broadcast: async () => {
      await broadcastRawTx(fetch, base, txHex);
      return { txid: txId };
    },
  };
}

/** Compose, sign and broadcast an ordinal transfer in one shot. */
export async function sendOrdinal(
  params: SendOrdinalParams,
  deps: SendDeps,
): Promise<SendResult> {
  return (await prepareOrdinal(params, deps)).broadcast();
}
