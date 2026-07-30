import { describe, it, expect } from "vitest";
import type { KontorHoldings } from "@unspendablelabs/horizon-market-client";
import {
  SOURCE_LABEL,
  failure,
  headlineAmount,
  kontorFailure,
  type BalanceErrors,
} from "./balances.js";

/** A settled result in either state, without going through a real promise. */
const ok = <T>(value: T): PromiseSettledResult<T> => ({
  status: "fulfilled",
  value,
});
const ko = (reason: unknown): PromiseSettledResult<never> => ({
  status: "rejected",
  reason,
});

describe("failure", () => {
  it("is null for a read that answered, whatever it answered", () => {
    expect(failure(ok([]))).toBeNull();
    // An empty list is a legitimate answer: the wallet holds none.
    expect(failure(ok([{ asset: "XCP" }]))).toBeNull();
  });

  it("keeps the reason a rejected read carried", () => {
    expect(failure(ko(new Error("indexer 502")))).toBe("indexer 502");
    // Anything thrown that isn't an Error still has to be reportable.
    expect(failure(ko("socket hang up"))).toBe("socket hang up");
  });
});

describe("kontorFailure", () => {
  const holdings = (
    unavailable: KontorHoldings["unavailable"],
  ): KontorHoldings => ({ kor: null, nfts: [], unavailable });

  it("names each way a Kontor read can come back without reaching the chain", () => {
    expect(kontorFailure(holdings("runtime"))).toBe(
      "no Kontor backend could load here",
    );
    expect(kontorFailure(holdings("network"))).toBe(
      "Kontor is signet-only and this client targets another network",
    );
    expect(kontorFailure(holdings("wallet-key"))).toBe(
      "this wallet exposes no Taproot public key",
    );
  });

  it("is null when the read succeeded, or was never asked for", () => {
    expect(kontorFailure(holdings(null))).toBeNull();
    // No --include-kontor: not a failure, and the table footnotes it separately.
    expect(kontorFailure(null)).toBeNull();
  });
});

describe("headlineAmount", () => {
  const sum = (xs: { q: bigint }[]) =>
    xs.reduce((t, x) => t + x.q, 0n).toString();

  it("prints 0 only for a source that answered with no holdings", () => {
    expect(headlineAmount(null, [], sum)).toBe("0");
    expect(headlineAmount(null, [{ q: 7n }, { q: 3n }], sum)).toBe("10");
  });

  it("blanks the amount when the read failed, instead of claiming 0", () => {
    // The bug this guards: a rejected read folds into an empty list, which
    // computed a confident "0" indistinguishable from an empty wallet.
    expect(headlineAmount("indexer 502", [], sum)).toBeNull();
    // The error wins even if something did come back — we can't trust a partial.
    expect(headlineAmount("indexer 502", [{ q: 7n }], sum)).toBeNull();
  });
});

describe("SOURCE_LABEL", () => {
  it("names every source that can carry a failure", () => {
    // Keeps a newly-added error slot from printing nothing (or `undefined`) in
    // the footnotes — the labels and the error object must stay in step.
    const keys: (keyof BalanceErrors)[] = [
      "btc",
      "price",
      "counterparty",
      "zeld",
      "ordinals",
      "kontor",
    ];
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(SOURCE_LABEL[k]).toBeTruthy();
  });
});
