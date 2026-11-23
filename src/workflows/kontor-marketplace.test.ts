import { describe, it, expect, vi, beforeEach } from "vitest";
import * as btc from "bitcoinjs-lib";
import { hex } from "@scure/base";
import {
  p2tr,
  Script,
  SigHash,
  TaprootControlBlock,
  Transaction,
} from "@scure/btc-signer";
import { KontorSession, signet } from "@kontor/sdk";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";
import type { AtomicSwap } from "../types/index.js";
import {
  LocalSigner,
  type Signer,
  type SignPsbtHexOptions,
} from "../crypto/signer.js";
import {
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_ATTACH_GAS_LIMIT,
} from "../kontor/gas.js";

/**
 * The marketplace contract with `@kontor/sdk` 0.3.0-rc.8, end to end through
 * the client: the REAL `Attachment.offer()` / `IncomingOffer.accept()` and the
 * client's external-wallet `Signing` adapter, with only the transport faked (it
 * captures the `Reveal` the SDK composes instead of calling an indexer).
 *
 * What it pins down:
 *  - the seller signs the detach `SINGLE|ANYONECANPAY` (0x83) through the
 *    wallet adapter, and the SDK accepts that signature;
 *  - the buyer is the Sponsor: its input 0 carries a Sponsor bound to the
 *    seller's escrow input, at the gas the purchase pre-flight prices;
 *  - the seller's attach is self-paid at the gas the listing pre-flight prices.
 */

const { transport, api, swaps } = vi.hoisted(() => ({
  transport: { current: null as unknown },
  api: {
    createKontorFeeQuote: vi.fn(),
    createKontorSwap: vi.fn(),
    kontorBuy: vi.fn(),
  },
  swaps: { getPendingPurchaseTxIds: vi.fn() },
}));

// A real KontorSession, wired to the fake transport of the current test.
vi.mock("../kontor/session.js", async () => {
  const sdk = await import("@kontor/sdk");
  return {
    makeKontorSession: (args: {
      chain: typeof signet;
      signing: ConstructorParameters<typeof sdk.KontorSession>[0]["signing"];
    }) =>
      new sdk.KontorSession({
        chain: args.chain,
        signing: args.signing,
        transport: () => transport.current as never,
      }),
  };
});
// The pre-flights' chain reads have their own suite; the gas they price is
// asserted against what the SDK actually commits, below.
vi.mock("../kontor/preflight.js", () => {
  const ok = async () => ({ ok: true, error: null });
  return { preflightKontorListing: ok, preflightKontorPurchase: ok };
});
vi.mock("../api/kontor.js", () => api);
vi.mock("../api/atomic-swaps.js", () => swaps);

import { openKontorSellOrder } from "./sell-kontor.js";
import { fillKontorSwap } from "./buy-kontor.js";

const SELLER_KEY = "05".repeat(32);
const BUYER_KEY = "06".repeat(32);
const PRICE_SATS = 50_000;
const http = {} as unknown as HttpClient;
const ctx: KontorContext = {
  chain: signet,
  indexerUrl: "https://indexer.invalid/api",
  btcNetwork: btc.networks.testnet,
  fetch: (() =>
    Promise.reject(new Error("no network in this test"))) as typeof fetch,
};

/**
 * An external wallet that signs exactly what it is asked to: each input under
 * the sighash the request names, with a real key it never exposes.
 */
function honouringWallet(privateKey: string) {
  const addresses = new LocalSigner(privateKey, "testnet").getAddresses();
  const calls: Array<{ indices: number[]; options?: SignPsbtHexOptions }> = [];
  const signer: Signer = {
    getAddresses: () => addresses,
    signPsbtHex(psbtHex, indices, options) {
      calls.push({ indices, options });
      const tx = Transaction.fromPSBT(hex.decode(psbtHex), {
        allowUnknown: true,
        allowUnknownInputs: true,
        allowUnknownOutputs: true,
        disableScriptCheck: true,
      });
      for (const index of indices) {
        tx.signIdx(hex.decode(privateKey), index, [
          options?.sighashTypes?.[index] ?? SigHash.DEFAULT,
        ]);
      }
      return hex.encode(tx.toPSBT());
    },
    signMessage: () => "message-signature",
  };
  return { signer, calls, xOnly: addresses.xOnlyPubkey! };
}

/** A funding UTXO at `address`, in the SDK's `Utxo` shape. */
function utxo(address: string, txidByte: string, value: number) {
  return {
    txid: txidByte.repeat(32),
    vout: 0,
    value: BigInt(value),
    scriptPubKey: hex.encode(
      btc.address.toOutputScript(address, btc.networks.testnet),
    ),
  };
}

type CapturedReveal = {
  participants: Array<
    Record<string, unknown> & {
      x_only_public_key: string;
      sighash_type: number | null;
      commit_insts: { ops: Array<{ gas_limit: number; kind: unknown }> };
    }
  >;
  extra_outputs: unknown[];
};

/**
 * What the seller's indexer would answer for the attach: a finalized reveal
 * whose output 0 is the escrow, plus the detach leaf it committed to there.
 */
function composedAttach(sellerXOnly: string) {
  const key = hex.decode(sellerXOnly);
  const detachScript = Script.encode([key, "CHECKSIG"]);
  const escrow = p2tr(key, { script: detachScript }, signet.network, true);
  const [controlBlock] = escrow.tapLeafScript![0]!;
  const revealTx = new Transaction({ allowUnknownOutputs: true });
  revealTx.addInput({
    txid: hex.decode("44".repeat(32)),
    index: 0,
    witnessUtxo: { script: p2tr(key).script, amount: 10_000n },
  });
  revealTx.addOutput({ script: escrow.script, amount: 600n });
  revealTx.addOutput({ script: p2tr(key).script, amount: 9_000n });
  revealTx.updateInput(0, { finalScriptWitness: [new Uint8Array(64)] });
  return {
    revealTx,
    detachLeaf: {
      leafVersion: 0xc0,
      script: hex.encode(detachScript),
      controlBlock: hex.encode(TaprootControlBlock.encode(controlBlock)),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  swaps.getPendingPurchaseTxIds.mockResolvedValue([]);
});

/** List 1 KOR through the real offer path; returns what the test observed. */
async function listOneKor() {
  const seller = honouringWallet(SELLER_KEY);
  const sellerAddress = seller.signer.getAddresses().p2tr!;
  const feeAddress = new LocalSigner("07".repeat(32), "testnet").getAddresses()
    .p2wpkh;
  const attach = composedAttach(seller.xOnly);
  let reveal: CapturedReveal | undefined;
  transport.current = {
    async submitReveal(
      prepare: (utxos: unknown[]) => Promise<{
        revealTx: Transaction;
        value?: unknown;
      }>,
    ) {
      const prepared = await prepare([utxo(sellerAddress, "11", 20_000)]);
      return { result: { txid: prepared.revealTx.id }, value: prepared.value };
    },
    async composeAndSign(composed: CapturedReveal) {
      reveal = composed;
      return {
        commitHexes: [],
        revealTx: attach.revealTx,
        composed: {
          commits: [],
          reveal: {
            psbt_hex: "",
            output_info: [
              { ChainedEnvelope: { tap_leaf_script: attach.detachLeaf } },
            ],
          },
        },
      };
    },
  };
  api.createKontorFeeQuote.mockResolvedValue({
    feePaymentId: "fp_1",
    paymentAddress: feeAddress,
    paymentAmount: 700,
    feeWaived: false,
  });
  api.createKontorSwap.mockImplementation(async (_http, request) => ({
    swap: { id: "swap-1", ...request },
    created: true,
  }));

  await openKontorSellOrder(
    {
      listingType: "kontor",
      kontorAssetKind: "token",
      korAmount: "1",
      priceSats: PRICE_SATS,
      fundingUtxos: [{ txid: "11".repeat(32), vout: 0, value: 20_000 }],
    },
    http,
    seller.signer,
    ctx,
  );
  const request = api.createKontorSwap.mock.calls[0]![1] as {
    kontorOfferBlob: string;
    assetUtxoId: string;
  };
  return { seller, sellerAddress, attach, reveal: reveal!, request };
}

describe("Kontor marketplace offer (seller side)", () => {
  it("signs the detach SINGLE|ANYONECANPAY (0x83) through the wallet adapter", async () => {
    const { seller, attach, request } = await listOneKor();

    // The adapter asked the wallet for exactly the escrow input, under 0x83.
    expect(seller.calls).toEqual([
      { indices: [1], options: { sighashTypes: { 1: 0x83 } } },
    ]);
    // The SDK verified that signature and kept it in the offer: escrow at
    // input 1, the seller's price at output 1.
    const blob = JSON.parse(request.kontorOfferBlob) as { detachPsbt: string };
    const detach = Transaction.fromPSBT(hex.decode(blob.detachPsbt));
    const signature = detach.getInput(1).tapScriptSig?.[0]?.[1];
    expect(signature).toHaveLength(65);
    expect(signature![64]).toBe(SigHash.SINGLE_ANYONECANPAY);
    expect(detach.getInput(1).sighashType).toBe(SigHash.SINGLE_ANYONECANPAY);
    expect(detach.getOutput(1).amount).toBe(BigInt(PRICE_SATS));
    // The listing records the escrow the attach reveal created.
    expect(request.assetUtxoId).toBe(`${attach.revealTx.id}:0`);
  });

  it("self-pays the attach at the gas the listing pre-flight prices, with no Sponsor", async () => {
    const { seller, reveal } = await listOneKor();

    const [participant] = reveal.participants;
    expect(reveal.participants).toHaveLength(1);
    expect(participant!.x_only_public_key).toBe(seller.xOnly);
    // `null` = the launch default, ALL|ANYONECANPAY on the `kon` leaf.
    expect(participant!.sighash_type).toBeNull();
    expect(participant!.commit_insts.ops).toHaveLength(1);
    expect(participant!.commit_insts.ops[0]!.gas_limit).toBe(
      KONTOR_ATTACH_GAS_LIMIT,
    );
    expect(JSON.stringify(participant!.commit_insts)).not.toMatch(/Sponsor/);
    // Detach envelope first, Horizon's fee rider next, Change last.
    expect(Object.keys(reveal.extra_outputs[0] as object)).toEqual([
      "ChainedEnvelope",
    ]);
    expect(Object.keys(reveal.extra_outputs.at(-1) as object)).toEqual([
      "Change",
    ]);
    expect(reveal.extra_outputs).toHaveLength(3);
  });

  it("produces a blob a buyer's session reads as a valid offer", async () => {
    const { request } = await listOneKor();
    const buyer = honouringWallet(BUYER_KEY);
    const session = new KontorSession({
      chain: signet,
      identity: {
        xOnlyPubKey: buyer.xOnly,
        address: buyer.signer.getAddresses().p2tr!,
      } as never,
      transport: () => ({}) as never,
    });

    const inspection = await session
      .openOffer(request.kontorOfferBlob)
      .inspect();

    expect(inspection).toMatchObject({
      valid: true,
      price: BigInt(PRICE_SATS),
    });
    session.close();
  });
});

describe("Kontor marketplace accept (buyer side)", () => {
  it("makes the buyer the Sponsor, bound to the seller's escrow input", async () => {
    const { seller, sellerAddress, attach, request } = await listOneKor();
    const buyer = honouringWallet(BUYER_KEY);
    const buyerAddress = buyer.signer.getAddresses().p2tr!;
    let reveal: CapturedReveal | undefined;
    let swapReveal: Transaction | undefined;
    transport.current = {
      async submitReveal(
        prepare: (utxos: unknown[]) => Promise<{ revealTx: Transaction }>,
      ) {
        const prepared = await prepare([utxo(buyerAddress, "22", 80_000)]);
        swapReveal = prepared.revealTx;
        return { result: { txid: prepared.revealTx.id } };
      },
      async composeAndSign(composed: CapturedReveal) {
        reveal = composed;
        const tx = new Transaction({ allowUnknownOutputs: true });
        tx.addInput({ txid: hex.decode("33".repeat(32)), index: 0 });
        tx.addInput({ txid: hex.decode(attach.revealTx.id), index: 0 });
        tx.addOutput({
          script: p2tr(hex.decode(buyer.xOnly)).script,
          amount: 1n,
        });
        tx.addOutput({
          script: p2tr(hex.decode(seller.xOnly)).script,
          amount: 1n,
        });
        return { commitHexes: ["00"], revealTx: tx, composed: {} };
      },
    };
    api.kontorBuy.mockImplementation(async (_http, swapId, body) => ({
      txId: body.txId,
      buyerAddress: body.buyerAddress,
      atomicSwap: { id: swapId },
    }));

    await fillKontorSwap(
      {
        id: "swap-1",
        kontorOfferBlob: request.kontorOfferBlob,
        assetUtxoId: request.assetUtxoId,
        sellerAddress,
        kontorAssetKind: "token",
        kontorAmount: "1",
        kontorNftId: null,
        kontorContractAddress: "token@0.0",
      } as unknown as AtomicSwap,
      {
        kontorFundingUtxos: [{ txid: "22".repeat(32), vout: 0, value: 80_000 }],
      },
      http,
      buyer.signer,
      ctx,
    );

    const [sponsor, escrow] = reveal!.participants;
    // Input 0: the buyer, whose single op is a Sponsor targeting input 1 at the
    // gas the purchase pre-flight checks the buyer can pay. The SDK fills in
    // the bound target (txid, vout, leaf hash, gas ceiling) and validates the
    // composer's answer; the client supplies none of it.
    expect(sponsor!.x_only_public_key).toBe(buyer.xOnly);
    expect(sponsor!.sighash_type).toBeNull(); // a Sponsor must be 0x81
    expect(sponsor!.commit_insts.ops).toHaveLength(1);
    expect(sponsor!.commit_insts.ops[0]).toMatchObject({
      gas_limit: KONTOR_ACCEPT_GAS_LIMIT,
      kind: { SponsorBound: { target_input_index: 1 } },
    });
    // Input 1: the seller's escrow, under the 0x83 the seller pre-signed.
    expect(escrow!.x_only_public_key).toBe(seller.xOnly);
    expect(escrow!.sighash_type).toBe(0x83);
    expect(escrow).toMatchObject({
      output: { Fixed: { value: PRICE_SATS } },
      commit_source: { Existing: { outpoint: request.assetUtxoId } },
    });
    // The seller's pre-signed witness rides input 1 of the swap reveal.
    const witness = swapReveal!.getInput(1).finalScriptWitness!;
    expect(witness[0]![64]).toBe(SigHash.SINGLE_ANYONECANPAY);
    // And the purchase is recorded under the swap reveal's txid.
    expect(api.kontorBuy).toHaveBeenCalledWith(http, "swap-1", {
      buyerAddress,
      txId: swapReveal!.id,
    });
  });
});
