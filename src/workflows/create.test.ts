import { describe, it, expect, vi } from "vitest";
import { base64, hex } from "@scure/base";
import { HttpClient } from "../api/http.js";
import {
  createToken,
  creationRetry,
  CreationNotBroadcastError,
} from "./create.js";
import type { CreationQuote } from "../api/creations.js";
import type { WorkflowProgressEvent } from "../types/index.js";
import {
  buildRevealPair,
  commitPsbtHexOf,
  FIXTURE_ISSUANCE_PSBT_HEX,
  makeAsyncSigner,
  makeSequentialFetch,
  makeSigner,
  REVEAL_FIXTURE,
  REVEAL_FIXTURE_WIRE,
  revealFixtureCommitPsbtHex,
  TEST_PRIVATE_KEY_HEX,
} from "../test-utils.js";
import { HDSigner, LocalSigner, type Signer } from "../crypto/signer.js";
import { PresignedRevealError, RevealVerificationError } from "../crypto/reveal.js";
import * as btc from "bitcoinjs-lib";

const NET = btc.networks.bitcoin;

/** A well-formed compressed key, which `public_key` is filled from. */
const COMPRESSED_KEY = `02${"ab".repeat(32)}`;

/**
 * A wallet over the fixture key whose `signPsbtHex` really signs — what a
 * reveal-bearing quote needs, since the commit it signs is checked — reporting
 * `addresses` on top of the key's own. `tamper` rewrites a PSBT before it is
 * signed, the way a misbehaving wallet would.
 */
function fixtureWallet(
  addresses: Partial<ReturnType<Signer["getAddresses"]>> = {},
  tamper: (psbtHex: string) => string = (psbtHex) => psbtHex,
): Signer {
  const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
  return {
    getAddresses: () => ({ ...local.getAddresses(), ...addresses }),
    signPsbtHex: vi.fn((psbtHex: string, indices: number[]) =>
      local.signPsbtHex(tamper(psbtHex), indices),
    ),
    signMessage: () => "sig",
  };
}

/** `psbtHex` with the unsigned transaction's locktime moved. */
function withLocktime(psbtHex: string, locktime: number): string {
  const psbt = btc.Psbt.fromHex(psbtHex);
  psbt.setLocktime(locktime);
  return psbt.toHex();
}

// A Counterparty quote whose message rides inline (OP_RETURN): no reveal.
const FIXTURE_PSBT_HEX = FIXTURE_ISSUANCE_PSBT_HEX;
const PSBT_BASE64 = base64.encode(hex.decode(FIXTURE_PSBT_HEX));

const WIRE_QUOTE = {
  type: "counterparty",
  identifier: "MYASSET",
  psbt: PSBT_BASE64,
  inputs_to_sign: [0],
  reveal_tx_hex: null,
  estimated_fee_sats: 1240,
  total_cost_sats: 1240,
};

const WIRE_ORDINALS_QUOTE = {
  ...WIRE_QUOTE,
  type: "ordinals",
  identifier: "abc123i0",
  reveal_tx_hex: "0200reveal",
  total_cost_sats: 1786,
};

const WIRE_RESULT = {
  type: "counterparty",
  identifier: "MYASSET",
  txid: "a".repeat(64),
  reveal_txid: null,
  inscription_id: null,
};

const BASE_PARAMS = {
  type: "counterparty" as const,
  name: "MYASSET",
  image: "ipfs://bafyimage",
};

function http(fetchFn: typeof globalThis.fetch): HttpClient {
  return new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
}

function bodyOf(
  fetchFn: typeof globalThis.fetch,
  call: number,
): Record<string, unknown> {
  const mock = fetchFn as ReturnType<typeof vi.fn>;
  const [, init] = mock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("createToken", () => {
  it("quotes, signs the hex form of the PSBT, and submits it", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = makeSigner();
    const events: WorkflowProgressEvent[] = [];

    const result = await createToken(BASE_PARAMS, http(fetchFn), signer, NET, {
      onProgress: (event) => events.push(event),
    });

    // The signer works in hex; the API answers base64. Getting this backwards
    // is a signature over the wrong bytes, not a parse error.
    expect(signer.signPsbtHex).toHaveBeenCalledWith(FIXTURE_PSBT_HEX, [0]);
    expect(bodyOf(fetchFn, 1)).toEqual({
      type: "counterparty",
      psbt: `${FIXTURE_PSBT_HEX}_signed`,
      identifier: "MYASSET",
    });
    expect(result.txid).toBe("a".repeat(64));
    expect(result.quote.psbtBase64).toBe(PSBT_BASE64);

    const steps = events.filter((e) => e.phase === "start").map((e) => e.step);
    expect(steps).toEqual([
      "validateParams",
      "requestCreationQuote",
      "signCreationPsbt",
      "submitCreation",
    ]);
    expect(events.every((e) => e.workflow === "createToken")).toBe(true);
    // The plan is known after validation, so only the first event predates it.
    expect(events[0]?.totalSteps).toBeNull();
    expect(events[events.length - 1]?.totalSteps).toBe(4);
  });

  it("awaits an external wallet's async signature", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );

    await createToken(BASE_PARAMS, http(fetchFn), makeAsyncSigner(), NET);

    // A dropped `await` would serialize the pending Promise as `{}` here.
    expect(bodyOf(fetchFn, 1).psbt).toBe(`${FIXTURE_PSBT_HEX}_signed`);
  });

  it("funds from p2wpkh and sends its compressed key for a Counterparty creation", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );

    await createToken(
      BASE_PARAMS,
      http(fetchFn),
      makeSigner({ publicKey: COMPRESSED_KEY }),
      NET,
    );

    // The key closes the taproot envelope when the issuance needs one
    // (Counterparty Core `multisig_pubkey`), so the wallet can sign the reveal.
    const body = bodyOf(fetchFn, 0);
    expect(body.address).toBe("bc1qseller");
    expect(body.public_key).toBe(COMPRESSED_KEY);
  });

  it("sends no public_key when the wallet shared no usable key", async () => {
    // An external wallet may expose no payment key, or a malformed one. The
    // server would answer a malformed `public_key` with a 400 — which would
    // break even an issuance whose message fits an OP_RETURN.
    for (const publicKey of ["", "02aabbcc", `04${"ab".repeat(64)}`, "b".repeat(64)]) {
      const fetchFn = makeSequentialFetch(
        { status: 200, body: { data: WIRE_QUOTE } },
        { status: 201, body: { data: WIRE_RESULT } },
      );

      await createToken(BASE_PARAMS, http(fetchFn), makeSigner({ publicKey }), NET);

      expect("public_key" in bodyOf(fetchFn, 0)).toBe(false);
      expect(bodyOf(fetchFn, 1).psbt).toBe(`${FIXTURE_PSBT_HEX}_signed`);
    }
  });

  it("refuses a malformed explicit publicKey before quoting, whatever the address", async () => {
    const fetchFn = makeSequentialFetch({ status: 200, body: { data: WIRE_QUOTE } });

    await expect(
      createToken({ ...BASE_PARAMS, publicKey: "02aabbcc" }, http(fetchFn), makeSigner(), NET),
    ).rejects.toThrow(/64 \(x-only\) or 66/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends no public_key for an address the signer does not own", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );

    await createToken(
      { ...BASE_PARAMS, address: "bc1qsomeoneelse" },
      http(fetchFn),
      makeSigner(),
      NET,
    );

    // The signer's key is not this address's key; the node looks it up itself.
    expect("public_key" in bodyOf(fetchFn, 0)).toBe(false);
  });

  it("sends the x-only key when the caller funds from taproot", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = makeSigner({
      p2tr: "bc1ptaproot",
      xOnlyPubkey: "b".repeat(64),
    });

    await createToken(
      { ...BASE_PARAMS, address: "bc1ptaproot" },
      http(fetchFn),
      signer,
      NET,
    );

    // The BIP84 `publicKey` would be rejected against a taproot input, so it
    // must be the BIP86 x-only one.
    expect(bodyOf(fetchFn, 0).public_key).toBe("b".repeat(64));
  });

  it("auto-fills the ordinals receive address and echoes the reveal verbatim", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ORDINALS_QUOTE } },
      {
        status: 201,
        body: {
          data: {
            type: "ordinals",
            identifier: "abc123i0",
            txid: "a".repeat(64),
            reveal_txid: "b".repeat(64),
            inscription_id: "abc123i0",
          },
        },
      },
    );
    const signer = fixtureWallet({ p2tr: "bc1preceiver" });

    const result = await createToken(
      { ...BASE_PARAMS, type: "ordinals", name: "My inscription" },
      http(fetchFn),
      signer,
      NET,
    );

    expect(bodyOf(fetchFn, 0).taproot_address).toBe("bc1preceiver");
    // An ordinal reveal is not a Counterparty message: no source key needed.
    expect("public_key" in bodyOf(fetchFn, 0)).toBe(false);
    expect(bodyOf(fetchFn, 1).reveal_tx_hex).toBe("0200reveal");
    expect(result.inscriptionId).toBe("abc123i0");
  });

  it("refuses an ordinal commit the wallet changed while signing", async () => {
    // The server signed the ordinal reveal against the quoted commit's txid: a
    // commit broadcast under any other txid would strand its output for good.
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ORDINALS_QUOTE } },
      { status: 201, body: { data: { ...WIRE_RESULT, type: "ordinals" } } },
    );
    const signer = fixtureWallet({ p2tr: "bc1preceiver" }, (psbtHex) =>
      withLocktime(psbtHex, 900_000),
    );

    await expect(
      createToken(
        { ...BASE_PARAMS, type: "ordinals", name: "My inscription" },
        http(fetchFn),
        signer,
        NET,
      ),
    ).rejects.toThrow(/changed the commit while signing it/);
    // Nothing was submitted, so nothing was broadcast.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses an ordinal when the signer exposes no taproot address", async () => {
    const fetchFn = makeSequentialFetch({ status: 200, body: { data: WIRE_QUOTE } });

    await expect(
      createToken(
        { ...BASE_PARAMS, type: "ordinals", name: "My inscription" },
        http(fetchFn),
        makeSigner(),
        NET,
      ),
    ).rejects.toThrow(/P2TR address to receive/);
    // Nothing was quoted: the check runs before the metered request.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips the quote step when the caller already holds one", async () => {
    const fetchFn = makeSequentialFetch({
      status: 201,
      body: { data: WIRE_RESULT },
    });
    const quote: CreationQuote = {
      type: "counterparty",
      identifier: "MYASSET",
      psbtBase64: PSBT_BASE64,
      inputsToSign: [0],
          revealTxHex: null,
      revealSigning: null,
      estimatedFeeSats: 1240,
      totalCostSats: 1240,
    };
    const events: WorkflowProgressEvent[] = [];

    const result = await createToken(
      { ...BASE_PARAMS, quote },
      http(fetchFn),
      makeSigner(),
      NET,
      { onProgress: (event) => events.push(event) },
    );

    // One request only — the confirm-modal flow must not pin a second descriptor.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.phase === "start").map((e) => e.step)).toEqual([
      "validateParams",
      "signCreationPsbt",
      "submitCreation",
    ]);
    expect(events[events.length - 1]?.totalSteps).toBe(3);
    expect(result.quote).toBe(quote);
  });

  it("marshals the counterparty options, fee rate nested and `lock` spelled right", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );

    await createToken(
      {
        ...BASE_PARAMS,
        satsPerVbyte: 9,
        options: { quantity: "1000", divisible: true, lock: false },
      },
      http(fetchFn),
      makeSigner(),
      NET,
    );

    expect(bodyOf(fetchFn, 0).options).toEqual({
      quantity: "1000",
      divisible: true,
      lock: false,
      fee_rate: 9,
    });
  });
});

describe("createToken submit failures", () => {
  const failing = (status: number, error: string) =>
    makeSequentialFetch(
      { status: 200, body: { data: WIRE_QUOTE } },
      { status, body: { error } },
    );

  it("carries the commit txid and the exact body to replay on a 502", async () => {
    const txid = "c".repeat(64);
    const fetchFn = failing(
      502,
      `The commit was broadcast as ${txid}, but its reveal was rejected.`,
    );

    const error = await createToken(BASE_PARAMS, http(fetchFn), makeSigner(), NET).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(CreationNotBroadcastError);
    const recovery = creationRetry(error);
    expect(recovery?.commitTxid).toBe(txid);
    // Deep-equal to what was actually sent: replaying anything else is a second
    // transaction, which for an ordinal strands the first commit forever.
    expect(recovery?.submit).toEqual({
      type: "counterparty",
      psbt: `${FIXTURE_PSBT_HEX}_signed`,
      identifier: "MYASSET",
    });
  });

  it("reports no commit txid when the failure named none", async () => {
    for (const [status, message] of [
      [502, "Bitcoin node unreachable."],
      [400, "psbt could not be finalised."],
    ] as const) {
      const error = await createToken(
        BASE_PARAMS,
        http(failing(status, message)),
        makeSigner(),
        NET,
      ).catch((e: unknown) => e);

      expect(creationRetry(error)?.commitTxid).toBeNull();
      expect((error as CreationNotBroadcastError).cause).toMatchObject({ status });
    }
  });

  it("only a 4xx clears the transaction as never broadcast", async () => {
    const txid = "c".repeat(64);

    // A 400 is the server rejecting the PSBT before it touches a node.
    const rejected = await createToken(
      BASE_PARAMS,
      http(failing(400, "psbt could not be finalised.")),
      makeSigner(),
      NET,
    ).catch((e: unknown) => e);
    expect(creationRetry(rejected)?.possiblyBroadcast).toBe(false);

    // A 502 that names no txid reads as "the node was unreachable" — but that
    // reading is a regex over prose, and being wrong lets the caller compose a
    // second transaction, which for an ordinal strands the first commit's funds
    // forever. So it stays held for replay, txid or no txid.
    for (const message of ["Bitcoin node unreachable.", `broadcast as ${txid}`]) {
      const unknown = await createToken(
        BASE_PARAMS,
        http(failing(502, message)),
        makeSigner(),
        NET,
      ).catch((e: unknown) => e);
      expect(creationRetry(unknown)?.possiblyBroadcast).toBe(true);
      expect((unknown as CreationNotBroadcastError).message).toMatch(
        /nothing is signed or paid again/,
      );
    }
  });

  it("answers null for anything that is not a creation submit failure", () => {
    expect(creationRetry(new Error("nope"))).toBeNull();
    expect(creationRetry(null)).toBeNull();
  });
});

// ─── Counterparty issuance in a taproot envelope ─────────────────────────────
// The node (≥ 11.5.0) returns the commit, the UNSIGNED reveal and what the
// wallet needs to sign it; the wallet signs both and the server broadcasts the
// pair. Fixtures: the node's own construction for TEST_PRIVATE_KEY_HEX.

const COMMIT_PSBT_HEX = revealFixtureCommitPsbtHex();
const WIRE_ENVELOPE_QUOTE = {
  ...WIRE_QUOTE,
  psbt: base64.encode(hex.decode(COMMIT_PSBT_HEX)),
  ...REVEAL_FIXTURE_WIRE,
};

function witnessOf(txHex: string): Uint8Array[] {
  return btc.Transaction.fromHex(txHex).ins[0].witness;
}

describe("createToken with a taproot envelope", () => {
  it("signs the commit and the reveal, and submits the signed reveal", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ENVELOPE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const events: WorkflowProgressEvent[] = [];

    const result = await createToken(
      { ...BASE_PARAMS, address: REVEAL_FIXTURE.sourceAddress },
      http(fetchFn),
      signer,
      NET,
      { onProgress: (event) => events.push(event) },
    );

    expect(bodyOf(fetchFn, 0).public_key).toBe(signer.getAddresses().publicKey);
    const body = bodyOf(fetchFn, 1);
    // The commit goes as a signed PSBT (the server finalizes it) …
    expect(String(body.psbt).startsWith("70736274ff")).toBe(true);
    // … and the reveal as a finalized transaction carrying the tapscript witness.
    const reveal = btc.Transaction.fromHex(String(body.reveal_tx_hex));
    expect(reveal.getId()).toBe(REVEAL_FIXTURE.revealTxid);
    const witness = witnessOf(String(body.reveal_tx_hex));
    expect(witness).toHaveLength(3);
    expect(witness[0]).toHaveLength(64);
    expect(Buffer.from(witness[1]).toString("hex")).toBe(REVEAL_FIXTURE.envelopeScript);
    expect(Buffer.from(witness[2]).toString("hex")).toBe(REVEAL_FIXTURE.controlBlock);
    expect(result.quote.revealSigning?.pubkey).toBe(REVEAL_FIXTURE.xOnlyPubkey);

    const steps = events.filter((e) => e.phase === "start").map((e) => e.step);
    expect(steps).toEqual([
      "validateParams",
      "requestCreationQuote",
      "signCreationPsbt",
      "signRevealTx",
      "submitCreation",
    ]);
    expect(events[events.length - 1]?.totalSteps).toBe(5);
  });

  it("awaits an external wallet for the reveal too", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ENVELOPE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const wallet: Signer = {
      getAddresses: () => local.getAddresses(),
      signPsbtHex: vi.fn(async (psbtHex: string, indices: number[]) =>
        local.signPsbtHex(psbtHex, indices),
      ),
      signMessage: async () => "sig",
    };

    await createToken(
      { ...BASE_PARAMS, address: REVEAL_FIXTURE.sourceAddress },
      http(fetchFn),
      wallet,
      NET,
    );

    // Two prompts: the commit PSBT, then a one-input reveal PSBT.
    expect(wallet.signPsbtHex).toHaveBeenCalledTimes(2);
    const revealPsbtHex = (wallet.signPsbtHex as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string;
    const psbt = btc.Psbt.fromHex(revealPsbtHex);
    expect(psbt.data.inputs).toHaveLength(1);
    expect(psbt.data.inputs[0].tapLeafScript).toHaveLength(1);
    expect(witnessOf(String(bodyOf(fetchFn, 1).reveal_tx_hex))).toHaveLength(3);
  });

  it("refuses a reveal pre-signed by an out-of-date server before signing anything", async () => {
    const fetchFn = makeSequentialFetch(
      {
        status: 200,
        body: {
          data: { ...WIRE_QUOTE, psbt: WIRE_ENVELOPE_QUOTE.psbt, reveal_tx_hex: "0200reveal" },
        },
      },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = makeSigner();

    await expect(
      createToken(BASE_PARAMS, http(fetchFn), signer, NET),
    ).rejects.toBeInstanceOf(PresignedRevealError);
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a commit that came back without its reveal", async () => {
    // A ≥ 11.5.0 node returns the reveal unsigned; a server that still only
    // forwards `signed_reveal_rawtransaction` forwards nothing — and the commit
    // alone would strand its output.
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: { ...WIRE_QUOTE, psbt: WIRE_ENVELOPE_QUOTE.psbt } } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = makeSigner();

    await expect(createToken(BASE_PARAMS, http(fetchFn), signer, NET)).rejects.toThrow(
      /no Counterparty data output and no reveal/,
    );
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("refuses signing material without a reveal", async () => {
    const fetchFn = makeSequentialFetch({
      status: 200,
      body: { data: { ...WIRE_ENVELOPE_QUOTE, reveal_tx_hex: null } },
    });

    await expect(createToken(BASE_PARAMS, http(fetchFn), makeSigner(), NET)).rejects.toThrow(
      /signing material but no reveal/,
    );
  });

  it("refuses a reveal whose envelope is closed by another key", async () => {
    const fetchFn = makeSequentialFetch({
      status: 200,
      body: { data: WIRE_ENVELOPE_QUOTE },
    });
    const stranger = new LocalSigner("7".repeat(64));

    await expect(
      createToken(
        { ...BASE_PARAMS, address: stranger.getAddresses().p2wpkh },
        http(fetchFn),
        stranger,
        NET,
      ),
    ).rejects.toThrow(/key this wallet does not hold/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // Both signatures — commit and reveal — are collected before the server is
  // asked to broadcast anything, so there is no state in which the commit is
  // out and the reveal still unsigned. What a failed submit leaves behind for
  // replay is the body that was already signed, reveal included.
  it("keeps the wallet-signed reveal in the replay body when the submit fails", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ENVELOPE_QUOTE } },
      { status: 502, body: { error: "Bitcoin node unreachable." } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const signer: Signer = {
      getAddresses: () => local.getAddresses(),
      signPsbtHex: vi.fn((psbtHex: string, indices: number[]) =>
        local.signPsbtHex(psbtHex, indices),
      ),
      signMessage: () => "sig",
    };
    const client = http(fetchFn);

    const failure = await createToken(
      { ...BASE_PARAMS, address: REVEAL_FIXTURE.sourceAddress },
      client,
      signer,
      NET,
    ).catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(CreationNotBroadcastError);
    const retry = creationRetry(failure)!;
    expect(retry.possiblyBroadcast).toBe(true);
    // The persisted body carries the reveal the wallet signed, never the
    // server's unsigned one.
    const reveal = btc.Transaction.fromHex(retry.submit.revealTxHex!);
    expect(reveal.getId()).toBe(REVEAL_FIXTURE.revealTxid);
    expect(reveal.ins[0].witness).toHaveLength(3);
    expect(retry.submit.revealTxHex).not.toBe(REVEAL_FIXTURE.revealTxHex);
    expect(signer.signPsbtHex).toHaveBeenCalledTimes(2);

    // Replaying re-POSTs that exact body: nothing is signed again.
    const { submitCreation } = await import("../api/creations.js");
    await submitCreation(client, retry.submit);
    expect(signer.signPsbtHex).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn, 2)).toEqual({
      type: "counterparty",
      psbt: retry.submit.psbt,
      identifier: "MYASSET",
      reveal_tx_hex: retry.submit.revealTxHex,
    });
  });

  it("does not require the guard for ordinals", async () => {
    // An ordinal commit has no inline data either, and its reveal is signed
    // server-side by design: the Counterparty rule must not fire on it.
    const fetchFn = makeSequentialFetch(
      {
        status: 200,
        body: {
          data: { ...WIRE_ORDINALS_QUOTE, psbt: WIRE_ENVELOPE_QUOTE.psbt },
        },
      },
      { status: 201, body: { data: { ...WIRE_RESULT, type: "ordinals" } } },
    );

    await createToken(
      { ...BASE_PARAMS, type: "ordinals", name: "My inscription" },
      http(fetchFn),
      fixtureWallet({ p2tr: "bc1preceiver" }),
      NET,
    );

    expect(bodyOf(fetchFn, 1).reveal_tx_hex).toBe("0200reveal");
  });
});

describe("createToken reveal checks", () => {
  // An HD wallet has two keys: BIP84 behind its p2wpkh, BIP86 behind its p2tr.
  const hd = new HDSigner({
    segwitKeyHex: TEST_PRIVATE_KEY_HEX,
    taprootKeyHex: "1".repeat(64),
  });
  const hdAddresses = hd.getAddresses();
  const hdSegwitScript = btc.address.toOutputScript(hdAddresses.p2wpkh, NET);

  function hdWallet(): Signer {
    return {
      getAddresses: () => hd.getAddresses(),
      signPsbtHex: vi.fn((psbtHex: string, indices: number[]) =>
        hd.signPsbtHex(psbtHex, indices),
      ),
      signMessage: () => "sig",
    };
  }

  /** A creation quote whose envelope is closed by `envelopeKey`, funded by `source`. */
  function envelopeQuote(envelopeKey: string, source: Uint8Array) {
    const pair = buildRevealPair(envelopeKey);
    return {
      ...WIRE_QUOTE,
      psbt: base64.encode(hex.decode(commitPsbtHexOf(pair.commitTxHex, source))),
      reveal_tx_hex: pair.revealTxHex,
      envelope_script: pair.material.envelopeScript,
      reveal_control_block: pair.material.controlBlock,
      reveal_pubkey: pair.material.pubkey,
      reveal_lock_scripts: [pair.material.lockScript],
      reveal_inputs_values: [pair.material.inputValue],
    };
  }

  it("signs for an HD wallet funding from its segwit address", async () => {
    const fetchFn = makeSequentialFetch(
      {
        status: 200,
        body: { data: envelopeQuote(hdAddresses.publicKey.slice(2), hdSegwitScript) },
      },
      { status: 201, body: { data: WIRE_RESULT } },
    );

    await createToken(BASE_PARAMS, http(fetchFn), hdWallet(), NET);

    expect(witnessOf(String(bodyOf(fetchFn, 1).reveal_tx_hex))).toHaveLength(3);
  });

  it("refuses an envelope closed by a wallet key that does not fund the commit", async () => {
    // The wallet holds the BIP86 key, but the commit is funded by its BIP84
    // address: the node attributes the reveal to that address only, so the
    // issuance would be lost. Refused before the first prompt.
    const fetchFn = makeSequentialFetch({
      status: 200,
      body: { data: envelopeQuote(hdAddresses.xOnlyPubkey!, hdSegwitScript) },
    });
    const signer = hdWallet();

    const error = await createToken(BASE_PARAMS, http(fetchFn), signer, NET).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RevealVerificationError);
    expect((error as Error).message).toMatch(/not one of the address funding the commit/);
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a commit input whose signature would move the commit's txid", async () => {
    // A legacy input signs into its scriptSig, which the txid covers: the
    // reveal, built against the unsigned commit, would spend nothing.
    const p2pkh = btc.payments.p2pkh({
      pubkey: Buffer.from(hdAddresses.publicKey, "hex"),
    }).output!;
    const fetchFn = makeSequentialFetch({
      status: 200,
      body: { data: envelopeQuote(REVEAL_FIXTURE.xOnlyPubkey, p2pkh) },
    });
    const signer = fixtureWallet();

    await expect(createToken(BASE_PARAMS, http(fetchFn), signer, NET)).rejects.toThrow(
      /does not spend a native segwit output/,
    );
    expect(signer.signPsbtHex).not.toHaveBeenCalled();
  });

  it("refuses a commit the wallet changed while signing, before the reveal prompt", async () => {
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ENVELOPE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const signer = fixtureWallet({}, (psbtHex) =>
      psbtHex === COMMIT_PSBT_HEX ? withLocktime(psbtHex, 900_000) : psbtHex,
    );

    await expect(
      createToken(
        { ...BASE_PARAMS, address: REVEAL_FIXTURE.sourceAddress },
        http(fetchFn),
        signer,
        NET,
      ),
    ).rejects.toThrow(/changed the commit while signing it/);
    // The reveal was never put to the wallet, and nothing was submitted.
    expect(signer.signPsbtHex).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("accepts a reveal the wallet hands back already finalized", async () => {
    // Some wallets finalize what they sign (Unisat does by default).
    const fetchFn = makeSequentialFetch(
      { status: 200, body: { data: WIRE_ENVELOPE_QUOTE } },
      { status: 201, body: { data: WIRE_RESULT } },
    );
    const local = new LocalSigner(TEST_PRIVATE_KEY_HEX);
    const signer: Signer = {
      getAddresses: () => local.getAddresses(),
      signPsbtHex: async (psbtHex: string, indices: number[]) => {
        const signed = btc.Psbt.fromHex(local.signPsbtHex(psbtHex, indices));
        if (signed.data.inputs[0].tapLeafScript) signed.finalizeAllInputs();
        return signed.toHex();
      },
      signMessage: async () => "sig",
    };

    await createToken(
      { ...BASE_PARAMS, address: REVEAL_FIXTURE.sourceAddress },
      http(fetchFn),
      signer,
      NET,
    );

    const reveal = btc.Transaction.fromHex(String(bodyOf(fetchFn, 1).reveal_tx_hex));
    expect(reveal.getId()).toBe(REVEAL_FIXTURE.revealTxid);
    expect(reveal.ins[0].witness).toHaveLength(3);
  });
});
