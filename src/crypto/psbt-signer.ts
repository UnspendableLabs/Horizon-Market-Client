import * as btc from "bitcoinjs-lib";
import { ECPair, ecc } from "./ecc.js";

type EccLib = typeof ecc;

/**
 * Create a Taproot signer object that signs with the key-path tweaked private key.
 * Ported from Horizon Market's Web3Auth wallet implementation.
 */
function createTaprootSigner(
  keyPair: ReturnType<typeof ECPair.fromPrivateKey>,
  eccLib: EccLib,
): {
  publicKey: Buffer;
  sign(hash: Buffer): Buffer;
  signSchnorr(hash: Buffer): Buffer;
} {
  if (!keyPair.privateKey) {
    throw new Error("Cannot create Taproot signer: private key is missing");
  }
  const xOnlyPubkey = keyPair.publicKey.subarray(1, 33);
  let privateKey = new Uint8Array(keyPair.privateKey);

  // Negate if leading byte is 0x03 (odd y-coordinate)
  if (keyPair.publicKey[0] === 3) {
    privateKey = new Uint8Array(eccLib.privateNegate(privateKey));
  }

  const tweakHash = btc.crypto.taggedHash("TapTweak", xOnlyPubkey);
  const tweakedPrivateKey = eccLib.privateAdd(privateKey, tweakHash);
  if (!tweakedPrivateKey) {
    throw new Error(
      "Failed to compute tweaked private key for Taproot signing",
    );
  }

  const tweakResult = eccLib.xOnlyPointAddTweak(xOnlyPubkey, tweakHash);
  if (!tweakResult) {
    throw new Error(
      "Failed to compute tweaked public key for Taproot signing",
    );
  }

  const tweakedPubkey = Buffer.from(tweakResult.xOnlyPubkey);

  return {
    publicKey: tweakedPubkey,
    sign(hash: Buffer): Buffer {
      return keyPair.sign(hash);
    },
    signSchnorr(hash: Buffer): Buffer {
      return Buffer.from(eccLib.signSchnorr(hash, tweakedPrivateKey));
    },
  };
}

/**
 * Sign a PSBT hex string at the given input indices using the provided private key.
 *
 * - Detects Taproot inputs via `tapInternalKey` and uses key-path tweaked signing.
 * - Only signs the specified input indices; never modifies order or other inputs.
 * - Returns the signed PSBT as hex (NOT finalized — do not call finalizeAllInputs here).
 */
export function signPsbtHex(
  psbtHex: string,
  inputIndices: number[],
  privateKeyHex: string,
  network: btc.Network,
): string {
  const psbt = btc.Psbt.fromHex(psbtHex, { network });

  const privateKeyBuffer = Buffer.from(
    privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex,
    "hex",
  );

  try {
    const keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network });

    const allowedSighashTypes = [
      btc.Transaction.SIGHASH_DEFAULT,
      btc.Transaction.SIGHASH_ALL,
      btc.Transaction.SIGHASH_NONE,
      btc.Transaction.SIGHASH_SINGLE | btc.Transaction.SIGHASH_ANYONECANPAY,
    ];

    for (const inputIndex of inputIndices) {
      const input = psbt.data.inputs[inputIndex];
      const isTaproot = !!input.tapInternalKey;
      const signer = isTaproot ? createTaprootSigner(keyPair, ecc) : keyPair;

      psbt.signInput(inputIndex, signer, allowedSighashTypes);
    }

    return psbt.toHex();
  } finally {
    privateKeyBuffer.fill(0);
  }
}

/**
 * Finalize all inputs and extract the raw transaction.
 * Use ONLY for prep PSBTs (attach commit / zeld transfer) that must be broadcast
 * as raw tx hex. Do NOT call this on swap or fee PSBTs.
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
