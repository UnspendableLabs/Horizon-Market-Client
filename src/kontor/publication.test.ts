import { describe, it, expect, vi } from "vitest";
import { hex } from "@scure/base";
import { p2tr, Transaction } from "@scure/btc-signer";
import {
  inMemoryFunding,
  PendingSubmission,
  SubmissionError,
  TransportError,
  type BroadcastReport,
  type Utxo,
} from "@kontor/sdk";
import {
  isKontorSubmissionError,
  KontorPublicationUnresolvedError,
  recoveredRevealTxid,
  settleKontorPublication,
  unresolvedKontorPublication,
} from "./publication.js";

/**
 * Uncertain publications, against the SDK's own recovery machinery: a real
 * `PendingSubmission` over a real funding lease, whose relay is the only thing
 * faked — it answers with the `BroadcastReport` a node would return.
 */

const SCRIPT = hex.encode(p2tr(hex.decode("ab".repeat(32))).script);
const FUNDING: Utxo = {
  txid: "11".repeat(32),
  vout: 0,
  value: 10_000n,
  scriptPubKey: SCRIPT,
};

/** A raw transaction spending `txidByte:0` — content only needs to parse. */
function rawTx(txidByte: string): string {
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({ txid: hex.decode(txidByte.repeat(32)), index: 0 });
  tx.addOutput({ script: hex.decode(SCRIPT), amount: 9_000n });
  return hex.encode(tx.unsignedTx);
}

type Request = (
  mode: "broadcast" | "reconcile",
  raw: string[],
) => Promise<unknown>;

/**
 * A two-transaction package (commit + reveal) left uncertain, as the SDK
 * hands it back: the lease is held, nothing has been settled.
 */
async function uncertainPackage(request: Request) {
  const funding = inMemoryFunding([FUNDING]);
  const lease = await funding.reserve();
  const saved = { result: { txid: "from-saved-result" }, value: "saved-value" };
  const pending = new PendingSubmission(
    [rawTx("11"), rawTx("22")],
    saved,
    lease,
    { spent: [FUNDING], change: [] },
    request,
    () => {},
  );
  return { pending, funding, saved };
}

/** The report a node returns for `pending`, every transaction as `status`. */
function report(
  pending: PendingSubmission,
  statuses: Array<"accepted" | "unknown">,
): BroadcastReport {
  const accepted = statuses.filter((s) => s === "accepted").length;
  return {
    outcome:
      accepted === statuses.length
        ? "accepted"
        : accepted > 0
          ? "partial"
          : "unknown",
    transactions: pending.transactions.map((tx, i) => ({
      txid: tx.txid,
      wtxid: tx.wtxid,
      status: statuses[i]!,
      reason: statuses[i] === "accepted" ? null : "not observed",
    })),
  };
}

describe("isKontorSubmissionError", () => {
  it("recognises the SDK's SubmissionError, and nothing merely named like it", async () => {
    const { pending } = await uncertainPackage(async () => ({}));
    expect(isKontorSubmissionError(new SubmissionError(pending))).toBe(true);

    const impostor = new Error("lost");
    impostor.name = "SubmissionError";
    expect(isKontorSubmissionError(impostor)).toBe(false);
    expect(isKontorSubmissionError(new TransportError("offline"))).toBe(false);
    expect(isKontorSubmissionError("SubmissionError")).toBe(false);
  });
});

describe("settleKontorPublication", () => {
  it("returns a clean publication untouched", async () => {
    const fromSaved = vi.fn();
    await expect(
      settleKontorPublication("transfer", async () => "txid", fromSaved),
    ).resolves.toBe("txid");
    expect(fromSaved).not.toHaveBeenCalled();
  });

  it("rethrows a failure that published nothing, as is", async () => {
    // A compose rejection or a refused signature: no SubmissionError, so the
    // SDK has already released its funding and there is nothing to recover.
    const refusal = new TransportError("Compose response rejected: fee rate");
    await expect(
      settleKontorPublication(
        "transfer",
        () => Promise.reject(refusal),
        () => "unused",
      ),
    ).rejects.toBe(refusal);
  });

  it("carries on with the saved result when a read-only re-check finds the whole package", async () => {
    // The broadcast went through but its response was lost.
    const request = vi.fn<Request>();
    const { pending, funding } = await uncertainPackage(request);
    request.mockImplementation(async () =>
      report(pending, ["accepted", "accepted"]),
    );

    const txid = await settleKontorPublication(
      "purchase",
      () => Promise.reject(new SubmissionError(pending)),
      recoveredRevealTxid,
    );

    expect(txid).toBe("from-saved-result");
    // Read-only, with the exact signed bytes — never a re-broadcast, never a
    // freshly composed package.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "reconcile",
      pending.transactions.map((tx) => tx.hex),
    );
    expect(pending.status).toBe("accepted");
    // The accepted package settled its lease: the reservation is over and the
    // spent coin is retired, so the pool is merely empty — not blocked on an
    // unresolved prior submission.
    await expect(funding.reserve()).rejects.toThrow(/no spendable UTXOs/);
  });

  it("hands the recovery handle out when only part of the package is observed", async () => {
    // Bitcoin took the commit and not the reveal.
    const request = vi.fn<Request>();
    const { pending, funding } = await uncertainPackage(request);
    request.mockImplementation(async () =>
      report(pending, ["accepted", "unknown"]),
    );

    const err = await settleKontorPublication(
      "transfer",
      () => Promise.reject(new SubmissionError(pending)),
      recoveredRevealTxid,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(KontorPublicationUnresolvedError);
    const unresolved = err as KontorPublicationUnresolvedError;
    expect(unresolved.operation).toBe("transfer");
    expect(unresolved.recovery).toBe(pending);
    // The reveal is the package's last transaction.
    expect(unresolved.txid).toBe(pending.transactions[1]!.txid);
    expect(unresolved.message).toContain(unresolved.txid);
    expect(unresolved.message).toMatch(/Do not start the transfer again/);
    expect(unresolved.recovery.report?.outcome).toBe("partial");
    // The lease is still held: nothing was settled or released on a guess.
    await expect(funding.reserve()).rejects.toThrow(
      /prior submission unresolved/,
    );
  });

  it("hands the recovery handle out when the re-check itself cannot reach the node", async () => {
    const { pending } = await uncertainPackage(async () => {
      throw new TransportError("offline");
    });

    await expect(
      settleKontorPublication(
        "delisting",
        () => Promise.reject(new SubmissionError(pending)),
        recoveredRevealTxid,
      ),
    ).rejects.toMatchObject({
      name: "KontorPublicationUnresolvedError",
      operation: "delisting",
      recovery: pending,
    });
  });

  it("does not continue when the saved result lacks what the caller needs", async () => {
    const request = vi.fn<Request>();
    const { pending } = await uncertainPackage(request);
    request.mockImplementation(async () =>
      report(pending, ["accepted", "accepted"]),
    );

    await expect(
      settleKontorPublication(
        "listing",
        () => Promise.reject(new SubmissionError(pending)),
        () => null,
      ),
    ).rejects.toBeInstanceOf(KontorPublicationUnresolvedError);
  });
});

describe("recoveredRevealTxid", () => {
  it("prefers the saved result's txid and falls back to the package's reveal", async () => {
    const { pending } = await uncertainPackage(async () => ({}));
    expect(recoveredRevealTxid({ result: { txid: "abc" } }, pending)).toBe(
      "abc",
    );
    expect(recoveredRevealTxid(undefined, pending)).toBe(
      pending.transactions[1]!.txid,
    );
  });
});

describe("unresolvedKontorPublication", () => {
  it("picks out the unresolved error, including a second copy of its class", async () => {
    const { pending } = await uncertainPackage(async () => ({}));
    const unresolved = new KontorPublicationUnresolvedError(
      "transfer",
      pending,
      new Error("lost"),
    );
    expect(unresolvedKontorPublication(unresolved)).toBe(unresolved);

    const copy = Object.assign(new Error(unresolved.message), {
      name: "KontorPublicationUnresolvedError",
      recovery: pending,
    });
    expect(unresolvedKontorPublication(copy)).toBe(copy);
  });

  it("is null for anything else, the SDK's own SubmissionError included", async () => {
    const { pending } = await uncertainPackage(async () => ({}));
    const named = new Error("no handle");
    named.name = "KontorPublicationUnresolvedError";
    expect(unresolvedKontorPublication(named)).toBeNull();
    expect(unresolvedKontorPublication(new SubmissionError(pending))).toBeNull();
    expect(unresolvedKontorPublication(new Error("refused"))).toBeNull();
    expect(unresolvedKontorPublication(null)).toBeNull();
  });

  it("its recovery re-sends the exact signed bytes, which is what a UI's re-check runs", async () => {
    const request = vi.fn<Request>();
    const { pending, saved } = await uncertainPackage(request);
    const raw = pending.transactions.map((tx) => tx.hex);

    request.mockResolvedValueOnce(report(pending, ["accepted", "unknown"]));
    await expect(pending.retry()).rejects.toBeInstanceOf(SubmissionError);
    request.mockResolvedValueOnce(report(pending, ["accepted", "accepted"]));
    await expect(pending.retry()).resolves.toBe(saved);

    expect(request.mock.calls).toEqual([
      ["broadcast", raw],
      ["broadcast", raw],
    ]);
  });
});
