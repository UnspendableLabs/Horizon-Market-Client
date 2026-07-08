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

/** P2TR scriptPubKey: OP_1 (0x51) PUSH_32 (0x20) <32-byte output key>. */
function isP2trScript(script: Uint8Array | undefined): boolean {
  return (
    !!script && script.length === 34 && script[0] === 0x51 && script[1] === 0x20
  );
}

function hexToKeyBuffer(privateKeyHex: string): Buffer {
  return Buffer.from(
    privateKeyHex.startsWith("0x") ? privateKeyHex.slice(2) : privateKeyHex,
    "hex",
  );
}

const ALLOWED_SIGHASH_TYPES = [
  btc.Transaction.SIGHASH_DEFAULT,
  btc.Transaction.SIGHASH_ALL,
  btc.Transaction.SIGHASH_SINGLE | btc.Transaction.SIGHASH_ANYONECANPAY,
];

/**
 * Sign a PSBT hex string at the given input indices, choosing a key per input by
 * script type: Taproot inputs are signed with `taprootKeyHex` (key-path tweaked),
 * everything else with `ecdsaKeyHex`. For the single-key wallet model pass the
 * same hex for both; for a Horizon-Wallet-style HD wallet pass the BIP86 key as
 * `taprootKeyHex` and the BIP84 key as `ecdsaKeyHex`.
 *
 * - Detects Taproot inputs via `tapInternalKey` OR a P2TR `witnessUtxo` script and
 *   uses key-path tweaked signing. Server-composed fee PSBTs sometimes carry only the
 *   P2TR `witnessUtxo` and omit `tapInternalKey`; bitcoinjs still routes such inputs
 *   through its Taproot signer (so the raw ECDSA key is rejected) but key-spend hashing
 *   requires `tapInternalKey` to be present, so we backfill it from the taproot key's
 *   own x-only pubkey.
 * - Only signs the specified input indices; never modifies order or other inputs.
 * - Returns the signed PSBT as hex (NOT finalized — do not call finalizeAllInputs here).
 */
export function signPsbtHexWithKeys(
  psbtHex: string,
  inputIndices: number[],
  keys: { ecdsaKeyHex: string; taprootKeyHex: string },
  network: btc.Network,
): string {
  const psbt = btc.Psbt.fromHex(psbtHex, { network });

  const ecdsaBuffer = hexToKeyBuffer(keys.ecdsaKeyHex);
  const sameKey = keys.ecdsaKeyHex === keys.taprootKeyHex;
  const taprootBuffer = sameKey ? ecdsaBuffer : hexToKeyBuffer(keys.taprootKeyHex);

  try {
    const ecdsaKeyPair = ECPair.fromPrivateKey(ecdsaBuffer, { network });
    const taprootKeyPair = sameKey
      ? ecdsaKeyPair
      : ECPair.fromPrivateKey(taprootBuffer, { network });

    const taprootXOnly = taprootKeyPair.publicKey.subarray(1, 33);

    for (const inputIndex of inputIndices) {
      const input = psbt.data.inputs[inputIndex];
      const isTaproot =
        !!input.tapInternalKey || isP2trScript(input.witnessUtxo?.script);

      if (isTaproot) {
        // Key-spend hashing in bitcoinjs is gated on `tapInternalKey` being present;
        // backfill it from the taproot key when the composer left it off the input.
        if (!input.tapInternalKey) {
          input.tapInternalKey = Buffer.from(taprootXOnly);
        }
        psbt.signInput(
          inputIndex,
          createTaprootSigner(taprootKeyPair, ecc),
          ALLOWED_SIGHASH_TYPES,
        );
      } else {
        psbt.signInput(inputIndex, ecdsaKeyPair, ALLOWED_SIGHASH_TYPES);
      }
    }

    return psbt.toHex();
  } finally {
    ecdsaBuffer.fill(0);
    if (!sameKey) taprootBuffer.fill(0);
  }
}

/**
 * Sign a PSBT hex string at the given input indices using a single private key
 * for both SegWit and Taproot inputs (the web3auth single-key wallet model).
 * Thin wrapper over {@link signPsbtHexWithKeys}.
 */
export function signPsbtHex(
  psbtHex: string,
  inputIndices: number[],
  privateKeyHex: string,
  network: btc.Network,
): string {
  return signPsbtHexWithKeys(
    psbtHex,
    inputIndices,
    { ecdsaKeyHex: privateKeyHex, taprootKeyHex: privateKeyHex },
    network,
  );
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
