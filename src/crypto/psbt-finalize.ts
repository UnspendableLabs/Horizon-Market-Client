import * as btc from "bitcoinjs-lib";

/**
 * Finalize every input that is not final yet, and extract the raw transaction.
 * Use ONLY for prep PSBTs (attach commit / zeld transfer) and reveal PSBTs that
 * must be broadcast as raw tx hex. Do NOT call this on swap or fee PSBTs.
 *
 * An input the signer already finalized is kept as it is: an external wallet
 * may finalize what it signs (Unisat does by default), and finalizing clears
 * the fields a second pass would need, so bitcoinjs would throw on it.
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
  psbt.data.inputs.forEach((input, index) => {
    if (!input.finalScriptWitness && !input.finalScriptSig) {
      psbt.finalizeInput(index);
    }
  });
  const tx = psbt.extractTransaction();
  return {
    txHex: tx.toHex(),
    txId: tx.getId(),
  };
}
