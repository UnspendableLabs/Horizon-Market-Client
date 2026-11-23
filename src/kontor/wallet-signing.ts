import { hex } from "@scure/base";
import { SigHash, Transaction } from "@scure/btc-signer";
import { Identity } from "@kontor/sdk";
import type {
  Chain,
  SighashKind,
  Signing,
  SignPsbtOptions,
} from "@kontor/sdk";
import type { Signer } from "../crypto/signer.js";

/**
 * A Kontor `Signing` backed by an **external wallet** (browser extension, mobile
 * wallet) instead of an in-process private key.
 *
 * Where {@link LocalSigner.getKontorSigning} builds a `LocalKey` from a raw key,
 * a browser-extension wallet (Xverse, Horizon Wallet, …) never exposes its key —
 * it signs asynchronously through a popup. Kontor's `Signing` interface was
 * designed for exactly this: its only required primitive is `psbt()` (sign a
 * PSBT), which is what every taproot-capable wallet does. The optional
 * `schnorr()` (raw Schnorr-over-digest, used ONLY for BLS registration) is
 * omitted — wallets can't produce it, and none of the SDK's Kontor flows
 * (buy / sell / delist) need it.
 *
 * This adapter is the SDK-internal equivalent of Kontor's own
 * `@kontor/sdk/wallets/sats-connect` connector, but it delegates to the SDK's
 * generic {@link Signer} (`signPsbtHex` / `signMessage`) rather than binding to
 * sats-connect — so it works with ANY host-supplied external signer, whatever
 * wallet it wraps. See {@link getKontorSigning}, which selects it automatically.
 *
 * The wallet must sign every input under the sighash Kontor requests for it:
 * `ALL|ANYONECANPAY` (0x81) on `kon` TapScript-leaf inputs, `SINGLE|ANYONECANPAY`
 * (0x83) on a marketplace seller's detach, `SIGHASH_DEFAULT` on key-path inputs.
 * The SDK verifies each returned signature before broadcasting, so a wallet that
 * substitutes its own sighash fails the flow before anything is sent — but it
 * still fails. Test a wallet's 0x81 / 0x83 and mixed-input support before
 * relying on it.
 *
 * The wallet's **internal** taproot x-only public key (from
 * `getAddresses().xOnlyPubkey`) is Kontor's identity — NOT the tweaked output key
 * you would decode from a `bc1p…` address. Wallets return the internal key on
 * connect; `Identity.fromXOnly` re-tweaks it to derive the P2TR address, which we
 * assert matches the wallet's own `p2tr` so a wrong key / network fails loudly.
 */
export function createWalletKontorSigning(signer: Signer, chain: Chain): Signing {
  const addresses = signer.getAddresses();
  if (!addresses.p2tr || !addresses.xOnlyPubkey) {
    throw new Error(
      "Kontor via an external wallet needs a Taproot (P2TR) address and its " +
        "x-only public key. The connected signer's getAddresses() must return " +
        "both { p2tr, xOnlyPubkey } — read them from the wallet on connect.",
    );
  }

  const xOnly = normalizeXOnlyPubkey(addresses.xOnlyPubkey);
  const identity = Identity.fromXOnly(xOnly, chain);

  // The identity address is re-derived from the internal x-only key; it must
  // equal the wallet's own P2TR address. A mismatch means the wrong key was
  // supplied (e.g. the bech32m-tweaked OUTPUT key instead of the internal key)
  // or the signer is on a different network than `chain` — either would make
  // Kontor bind the session to an address the wallet can't actually sign for.
  if (identity.address.toLowerCase() !== addresses.p2tr.toLowerCase()) {
    throw new Error(
      `Kontor identity address (${identity.address}) derived from the wallet's ` +
        `x-only public key does not match the wallet's P2TR address ` +
        `(${addresses.p2tr}). The signer must expose its INTERNAL taproot x-only ` +
        `key (the one wallets return on connect), on the same network as the ` +
        `Kontor chain.`,
    );
  }

  return {
    identity,

    async psbt(psbt: Uint8Array, opts?: SignPsbtOptions): Promise<Uint8Array> {
      const inputs = opts?.inputs;
      if (inputs == null) {
        // Every Kontor call site passes an explicit `inputs` spec; without one we
        // can't know which inputs belong to the wallet. Mirror the sats-connect
        // connector and refuse rather than guess.
        throw new Error(
          "wallet Kontor signing: psbt() requires an explicit `inputs` spec.",
        );
      }
      if (inputs.length === 0) return psbt;

      // Each input keeps the sighash Kontor asked for, and one request may mix
      // them: a delist's revoke signs the escrow's script-path input under
      // ALL|ANYONECANPAY (0x81) and its key-path fee inputs under
      // SIGHASH_DEFAULT. Collapsing them to one sighash would make the SDK
      // reject the signatures (it verifies each one before broadcast).
      const sighashTypes: Record<number, number> = {};
      for (const { index, sighash } of inputs) {
        sighashTypes[index] = sighashFlag(sighash ?? "default");
      }

      let bytes = psbt;
      const stamped = inputs.filter(
        (i) => sighashTypes[i.index] !== SigHash.DEFAULT,
      );
      if (stamped.length > 0) {
        // Encode the non-default sighashes into their inputs so a signer that
        // reads the PSBT (and the wallet behind it) signs under them. Default
        // inputs are left as they are, as Kontor's own sats-connect adapter
        // does. `allowUnknown` preserves Kontor's proprietary PSBT fields
        // across the re-serialize.
        const tx = Transaction.fromPSBT(psbt, {
          allowUnknown: true,
          allowUnknownInputs: true,
          allowUnknownOutputs: true,
          disableScriptCheck: true,
        });
        for (const { index } of stamped) {
          tx.updateInput(index, { sighashType: sighashTypes[index] }, true);
        }
        bytes = tx.toPSBT();
      }

      // The same request, stated explicitly, for a signer whose wallet API
      // takes sighash lists rather than reading the PSBT field.
      const signedHex = await signer.signPsbtHex(
        hex.encode(bytes),
        inputs.map((i) => i.index),
        { sighashTypes },
      );
      return hex.decode(stripHexPrefix(signedHex));
    },

    async message(message: string | Uint8Array): Promise<string> {
      const text = typeof message === "string" ? message : hex.encode(message);
      return signer.signMessage(identity.address, text);
    },
  };
}

/**
 * Kontor `SighashKind` → the numeric sighash flag. Typed over the SDK's whole
 * union so a kind added by a future SDK release fails to compile here instead
 * of being signed under the wrong sighash.
 *
 * Kontor's launch format signs direct transactions through the `kon` TapScript
 * leaf under `all-anyonecanpay` (0x81); a marketplace seller signs the detach
 * under `single-anyonecanpay` (0x83); commits and fee inputs are key-path
 * spends under `default`.
 */
const SIGHASH_BY_KIND: Record<SighashKind, number> = {
  default: SigHash.DEFAULT,
  all: SigHash.ALL,
  "all-anyonecanpay": SigHash.ALL_ANYONECANPAY,
  "single-anyonecanpay": SigHash.SINGLE_ANYONECANPAY,
};

/** The flag for `kind`, refusing a kind this adapter does not know. */
function sighashFlag(kind: SighashKind): number {
  const flag = SIGHASH_BY_KIND[kind] as number | undefined;
  if (flag === undefined) {
    throw new Error(
      `wallet Kontor signing: unsupported sighash "${String(kind)}".`,
    );
  }
  return flag;
}

/**
 * Normalize a wallet-provided taproot public key to 64-hex x-only. Wallets return
 * either the 32-byte x-only key (64 hex) or the 33-byte compressed key (66 hex,
 * `02`/`03` parity prefix) — both name the same taproot internal key.
 */
function normalizeXOnlyPubkey(pubkey: string): string {
  const clean = pubkey.toLowerCase().replace(/^0x/, "");
  if (clean.length === 64) return clean;
  if (clean.length === 66) return clean.slice(2);
  throw new Error(
    `wallet Kontor signing: unexpected taproot public key length ` +
      `(${clean.length} hex chars); expected 64 (x-only) or 66 (compressed).`,
  );
}

/** Strip a leading `0x` so `@scure/base`'s strict `hex.decode` accepts the string. */
function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
