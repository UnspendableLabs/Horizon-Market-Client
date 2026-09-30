import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import {
  assertSellQuoteRevealSignable,
  buildSellPrepResult,
  signAndFinalizeSellPrep,
  signSellPrepReveal,
} from "./sell-prep.js";
import { LocalSigner } from "../crypto/signer.js";
import { PresignedRevealError, RevealVerificationError } from "../crypto/reveal.js";
import { signPsbtHex } from "../crypto/psbt-signer.js";
import type { Signer } from "../crypto/signer.js";
import type { SellQuote } from "../types/index.js";
import {
  FIXTURE_PSBT_HEX,
  REVEAL_FIXTURE,
  revealFixtureCommitPsbtHex,
  TEST_PRIVATE_KEY_HEX,
} from "../test-utils.js";

const BASE_QUOTE: SellQuote = {
  swapPsbt: "70736274ff_swap",
  swapInputsToSign: [0],
  feePsbt: null,
  feeInputsToSign: [],
  feePaymentId: "fp_abc",
  feeWaived: false,
  assetUtxoId: "preptxid:0",
  assetUtxoValue: 600,
  prepPsbt: null,
  prepInputsToSign: [],
  prepKind: null,
  listingFeeSats: null,
  attachFeeSats: null,
  networkFeeSats: null,
};

function hybridSigner(): Signer {
  return {
    getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
    signPsbtHex: vi.fn((hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    ),
    signMessage: () => "base64sig",
  };
}

/** {@link hybridSigner} whose signPsbtHex resolves asynchronously (external wallet). */
function asyncHybridSigner(): Signer {
  return {
    getAddresses: () => ({ p2wpkh: "bc1qseller", publicKey: "02aabb" }),
    signPsbtHex: vi.fn(async (hex: string, indices: number[]) =>
      hex === FIXTURE_PSBT_HEX
        ? signPsbtHex(hex, indices, TEST_PRIVATE_KEY_HEX, btc.networks.bitcoin)
        : `${hex}_signed`,
    ),
    signMessage: async () => "base64sig",
  };
}

describe("signAndFinalizeSellPrep", () => {
  it("returns undefined when quote has no prep PSBT", async () => {
    const signer = hybridSigner();
    expect(
      await signAndFinalizeSellPrep(BASE_QUOTE, signer, btc.networks.bitcoin),
    ).toBeUndefined();
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("finalizes attach prep to funding_tx_hex", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "attach",
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.fundingTxHex?.startsWith("70736274ff")).toBe(false);
    expect(result?.revealTxHex).toBeUndefined();
    expect(result?.zeldPayment).toBeUndefined();
  });

  it("finalizes zeld transfer prep to zeld_payment fields", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "zeld_transfer",
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.zeldPayment).toMatchObject({ feePaymentId: "fp_abc" });
    expect(result?.zeldPayment?.zeldSendTxHex.startsWith("70736274ff")).toBe(
      false,
    );
    expect(result?.zeldPayment?.zeldSendTxId).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.fundingTxHex).toBeUndefined();
  });

  it("finalizes zeld transfer prep to funding_tx_hex when fee is waived", async () => {
    const signer = hybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "zeld_transfer",
        feeWaived: true,
        feePaymentId: null,
      },
      signer,
      btc.networks.bitcoin,
    );

    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.zeldPayment).toBeUndefined();
  });

  it("awaits an asynchronous signer before finalizing (external wallet)", async () => {
    const signer = asyncHybridSigner();
    const result = await signAndFinalizeSellPrep(
      {
        ...BASE_QUOTE,
        prepPsbt: FIXTURE_PSBT_HEX,
        prepInputsToSign: [0],
        prepKind: "attach",
      },
      signer,
      btc.networks.bitcoin,
    );

    // Finalization parses the RESOLVED signed hex as a transaction — an
    // unresolved Promise (dropped `await`) would not be finalizable hex.
    expect(result?.fundingTxHex).toMatch(/^[0-9a-f]+$/);
    expect(result?.fundingTxHex?.startsWith("70736274ff")).toBe(false);
  });

  it("throws when prep_psbt is present but prep_kind is null", async () => {
    const signer = hybridSigner();
    await expect(
      signAndFinalizeSellPrep(
        {
          ...BASE_QUOTE,
          prepPsbt: FIXTURE_PSBT_HEX,
          prepInputsToSign: [0],
          prepKind: null,
        },
        signer,
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow('Unexpected prep_kind "null"');
  });
});

// ─── Attach in a taproot envelope ────────────────────────────────────────────

describe("signAndFinalizeSellPrep with a taproot envelope", () => {
  const material = {
    envelopeScript: REVEAL_FIXTURE.envelopeScript,
    controlBlock: REVEAL_FIXTURE.controlBlock,
    pubkey: REVEAL_FIXTURE.xOnlyPubkey,
    lockScript: REVEAL_FIXTURE.lockScript,
    inputValue: REVEAL_FIXTURE.inputValue,
  };
  const envelopeQuote: SellQuote = {
    ...BASE_QUOTE,
    prepPsbt: revealFixtureCommitPsbtHex(),
    prepInputsToSign: [0],
    prepKind: "attach",
    revealTxHex: REVEAL_FIXTURE.revealTxHex,
    revealSigning: material,
    assetUtxoId: `${REVEAL_FIXTURE.revealTxid}:0`,
  };

  it("signs the commit, then the reveal against it", async () => {
    const signer = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const result = await signAndFinalizeSellPrep(
      envelopeQuote,
      signer,
      btc.networks.bitcoin,
    );

    const commit = btc.Transaction.fromHex(result!.fundingTxHex!);
    expect(commit.getId()).toBe(REVEAL_FIXTURE.commitTxid);
    const reveal = btc.Transaction.fromHex(result!.revealTxHex!);
    expect(reveal.getId()).toBe(REVEAL_FIXTURE.revealTxid);
    expect(reveal.ins[0].witness).toHaveLength(3);
    expect(Buffer.from(reveal.ins[0].witness[1]).toString("hex")).toBe(
      REVEAL_FIXTURE.envelopeScript,
    );
  });

  it("refuses a pre-signed reveal without asking for any signature", async () => {
    const signer = hybridSigner();
    await expect(
      signAndFinalizeSellPrep(
        { ...envelopeQuote, revealSigning: undefined, revealTxHex: "02000000reveal" },
        signer,
        btc.networks.bitcoin,
      ),
    ).rejects.toBeInstanceOf(PresignedRevealError);
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("refuses signing material without a reveal, and a quote with nothing to sign", async () => {
    const signer = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    await expect(
      signAndFinalizeSellPrep(
        { ...envelopeQuote, revealTxHex: undefined },
        signer,
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow(/signing material but no reveal/);
    await expect(
      signSellPrepReveal(BASE_QUOTE, "00", signer, btc.networks.bitcoin),
    ).rejects.toThrow(/no reveal to sign/);
  });

  it("refuses a reveal that has no attach commit to spend", async () => {
    const signer = spyOn(new LocalSigner(TEST_PRIVATE_KEY_HEX));
    await expect(
      signAndFinalizeSellPrep(
        { ...envelopeQuote, prepKind: "zeld_transfer" },
        signer,
        btc.networks.bitcoin,
      ),
    ).rejects.toThrow(/no attach commit for it to spend/);
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("checks the reveal against this wallet's keys before asking for any signature", async () => {
    const stranger = spyOn(new LocalSigner("7".repeat(64)));
    await expect(
      signAndFinalizeSellPrep(envelopeQuote, stranger, btc.networks.bitcoin),
    ).rejects.toThrow(/key this wallet does not hold/);
    expect(stranger.signPsbtHex).not.toHaveBeenCalled();

    expect(() =>
      assertSellQuoteRevealSignable(envelopeQuote, stranger.getAddresses()),
    ).toThrow(RevealVerificationError);
    expect(() =>
      assertSellQuoteRevealSignable(
        envelopeQuote,
        new LocalSigner(TEST_PRIVATE_KEY_HEX).getAddresses(),
      ),
    ).not.toThrow();
  });

  it("refuses a commit the wallet changed while signing, before the reveal prompt", async () => {
    const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const signer = spyOn(local, (psbtHex, indices) => {
      const psbt = btc.Psbt.fromHex(psbtHex);
      if (!psbt.data.inputs[0].tapLeafScript) psbt.setLocktime(900_000);
      return local.signPsbtHex(psbt.toHex(), indices);
    });
    await expect(
      signAndFinalizeSellPrep(envelopeQuote, signer, btc.networks.bitcoin),
    ).rejects.toThrow(/changed the commit while signing it/);
    expect(signer.signPsbtHex).toHaveBeenCalledTimes(1);
  });

  it("signSellPrepReveal signs against the finalized commit, and only that one", async () => {
    const signer = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const prep = buildSellPrepResult(
      envelopeQuote,
      signer.signPsbtHex(envelopeQuote.prepPsbt!, [0]),
      btc.networks.bitcoin,
    );
    expect(prep.revealTxHex).toBeUndefined();

    const revealTxHex = await signSellPrepReveal(
      envelopeQuote,
      prep.fundingTxHex!,
      signer,
      btc.networks.bitcoin,
    );
    expect(btc.Transaction.fromHex(revealTxHex).getId()).toBe(REVEAL_FIXTURE.revealTxid);

    // Any other transaction is not the commit the reveal spends.
    const other = btc.Transaction.fromHex(prep.fundingTxHex!);
    other.locktime = 1;
    await expect(
      signSellPrepReveal(envelopeQuote, other.toHex(), signer, btc.networks.bitcoin),
    ).rejects.toThrow(/the reveal spends/);
  });

  it("buildSellPrepResult refuses a pre-signed reveal", () => {
    expect(() =>
      buildSellPrepResult(
        { ...envelopeQuote, revealSigning: undefined },
        "00",
        btc.networks.bitcoin,
      ),
    ).toThrow(PresignedRevealError);
  });
});

/** `signer` with a spied `signPsbtHex` (optionally replaced by `sign`). */
function spyOn(
  signer: Signer,
  sign: (psbtHex: string, indices: number[]) => string = (psbtHex, indices) =>
    signer.signPsbtHex(psbtHex, indices) as string,
): Signer {
  return {
    getAddresses: () => signer.getAddresses(),
    signPsbtHex: vi.fn(sign),
    signMessage: () => "base64sig",
  };
}
