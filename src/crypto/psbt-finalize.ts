import * as btc from "bitcoinjs-lib";

/**
 * Finalize all inputs and extract the raw transaction.
 * Use ONLY for prep PSBTs (attach commit / zeld transfer) and reveal PSBTs that
 * must be broadcast as raw tx hex. Do NOT call this on swap or fee PSBTs.
 *
 * Deliberately free of any secp256k1 import: finalizing needs no curve
 * arithmetic, and keeping it apart lets `crypto/reveal.ts` (imported by the
 * creation workflow) load without the ECPair self-test that `ecc.ts` runs at
 * import time.
 */
export function finalizePsbtHex(
  psbtHex: string,
  network: btc.Network,
): { txHex: string; txId: string } {
  const psbt = btc.Psbt.fromHex(psbtHex, { network });
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return {
    txHex: tx.toHex(),
    txId: tx.getId(),
  };
}
