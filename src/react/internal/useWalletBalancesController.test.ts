// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, type CtxRef } from "../hook-test-utils.js";
import type { AssetOption } from "../hooks/useAssets.js";
import type { WithdrawTarget } from "../hooks/useWithdraw.js";
import {
  useWalletBalancesController,
  depositTargetFor,
  assetDepositLabel,
  otherLabel,
  withdrawTitle,
  withdrawKey,
  tokenDepositType,
} from "./useWalletBalancesController.js";
import type { WalletTokenSummary } from "./useWalletTokenSummary.js";

const { ctxRef, summaryRef, pricesRef } = vi.hoisted(() => ({
  ctxRef: { current: null } as CtxRef,
  summaryRef: { current: null } as { current: WalletTokenSummary | null },
  pricesRef: { current: { btcUsd: null as number | null, loading: false } },
}));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));
vi.mock("./useWalletTokenSummary.js", () => ({
  useWalletTokenSummary: () => summaryRef.current,
}));
vi.mock("../hooks/usePrices.js", () => ({ usePrices: () => pricesRef.current }));

const PEPE: AssetOption = {
  type: "counterparty",
  assetName: "PEPE",
  address: "bc1qwallet",
  balance: 42n,
  quantityNormalized: "42",
  divisible: false,
};
const NFT: AssetOption = {
  type: "kontor-nft",
  nftId: "nft-1234567890abcdef",
  contractAddress: "0xcontract",
  address: "bc1pwallet",
};
const ORD: AssetOption = {
  type: "ordinal",
  inscriptionId: "insc-abcdefghijklmnop",
  utxoId: "txid:0",
  address: "bc1pwallet",
};

function makeSummary(o: Partial<WalletTokenSummary> = {}): WalletTokenSummary {
  const btcLine = {
    symbol: "BTC" as const,
    amount: null,
    asset: null,
    sellAsset: null,
  };
  return {
    btc: btcLine,
    btcSats: null,
    primary: [],
    tokens: [btcLine],
    others: [],
    loading: false,
    isFetching: false,
    lastFetchedAt: null,
    refresh: vi.fn(),
    ...o,
  };
}

describe("useWalletBalancesController", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
    summaryRef.current = makeSummary();
    pricesRef.current = { btcUsd: null, loading: false };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through the token summary and derives the USD value", () => {
    summaryRef.current = makeSummary({ btcSats: 100_000_000n });
    pricesRef.current = { btcUsd: 50_000, loading: false };

    const { result } = renderHook(() => useWalletBalancesController());

    expect(result.current.btcSats).toBe(100_000_000n);
    expect(result.current.addresses).toEqual(ctxRef.current!.addresses);
    expect(result.current.usd).toContain("50,000");
  });

  it("returns null USD when there is no BTC balance", () => {
    summaryRef.current = makeSummary({ btcSats: null });
    pricesRef.current = { btcUsd: 50_000, loading: false };

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.usd).toBeNull();
  });

  it("returns null USD when there is no price", () => {
    summaryRef.current = makeSummary({ btcSats: 100_000_000n });
    pricesRef.current = { btcUsd: null, loading: false };

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.usd).toBeNull();
  });

  it("groups other holdings and defaults to the first non-empty tab", () => {
    summaryRef.current = makeSummary({ others: [PEPE, NFT, ORD] });

    const { result } = renderHook(() => useWalletBalancesController());

    expect(result.current.otherGroups.map((g) => g.label)).toEqual([
      "Counterparty",
      "Kontor",
      "Ordinals",
    ]);
    expect(result.current.otherGroups[0].options).toEqual([PEPE]);
    expect(result.current.otherGroups[1].options).toEqual([NFT]);
    expect(result.current.otherGroups[2].options).toEqual([ORD]);
    expect(result.current.activeLabel).toBe("Counterparty");
    expect(result.current.activeGroup.label).toBe("Counterparty");
  });

  it("defaults active tab to the first non-empty group when Counterparty is empty", () => {
    summaryRef.current = makeSummary({ others: [ORD] });

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.activeLabel).toBe("Ordinals");
    expect(result.current.activeGroup.label).toBe("Ordinals");
  });

  it("falls back to the first tab when there are no holdings at all", () => {
    summaryRef.current = makeSummary({ others: [] });

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.activeLabel).toBe("Counterparty");
    expect(result.current.activeGroup.label).toBe("Counterparty");
  });

  it("honours an explicit tab selection", () => {
    summaryRef.current = makeSummary({ others: [PEPE, NFT, ORD] });

    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.setOtherTab("Kontor"));

    expect(result.current.activeLabel).toBe("Kontor");
    expect(result.current.activeGroup.label).toBe("Kontor");
  });

  it("falls back to the first group when the selected tab does not exist", () => {
    summaryRef.current = makeSummary({ others: [PEPE] });

    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.setOtherTab("Nonexistent"));

    expect(result.current.activeLabel).toBe("Nonexistent");
    expect(result.current.activeGroup.label).toBe("Counterparty");
  });

  it("opens a Segwit deposit for a Counterparty symbol", () => {
    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.openDeposit("XCP", "counterparty"));

    expect(result.current.deposit).toEqual({
      symbol: "XCP",
      label: "Segwit (P2WPKH)",
      address: "bc1qwallet",
    });
  });

  it("opens a Taproot deposit for a Kontor symbol", () => {
    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.openDeposit("KOR", "kor"));

    expect(result.current.deposit).toEqual({
      symbol: "KOR",
      label: "Taproot (P2TR)",
      address: "bc1pwallet",
    });
  });

  it("does not open a deposit while disconnected", () => {
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.openDeposit("XCP", "counterparty"));

    expect(result.current.deposit).toBeNull();
    expect(result.current.addresses).toBeNull();
  });

  it("opens a deposit for a specific owned asset", () => {
    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.openDepositForAsset(PEPE));
    expect(result.current.deposit).toMatchObject({
      symbol: "PEPE",
      label: "Segwit (P2WPKH)",
    });

    act(() => result.current.openDepositForAsset(NFT));
    expect(result.current.deposit).toMatchObject({
      symbol: "NFT",
      label: "Taproot (P2TR)",
    });
  });

  it("closes the deposit modal", () => {
    const { result } = renderHook(() => useWalletBalancesController());
    act(() => result.current.openDeposit("XCP", "counterparty"));
    expect(result.current.deposit).not.toBeNull();

    act(() => result.current.closeDeposit());
    expect(result.current.deposit).toBeNull();
  });

  it("tracks the sell and withdraw modal targets", () => {
    const { result } = renderHook(() => useWalletBalancesController());

    act(() => result.current.setSellAsset(PEPE));
    expect(result.current.sellAsset).toBe(PEPE);

    const target: WithdrawTarget = PEPE;
    act(() => result.current.setWithdraw(target));
    expect(result.current.withdraw).toBe(target);
  });

  it("enables and opens the BTC withdraw when the balance is non-zero", () => {
    summaryRef.current = makeSummary({ btcSats: 500n });

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.canWithdrawBtc).toBe(true);

    act(() => result.current.openBtcWithdraw());
    expect(result.current.withdraw).toEqual({ type: "btc", balanceSats: 500n });
  });

  it("disables the BTC withdraw for a zero balance and no-ops open", () => {
    summaryRef.current = makeSummary({ btcSats: 0n });

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.canWithdrawBtc).toBe(false);

    act(() => result.current.openBtcWithdraw());
    expect(result.current.withdraw).toBeNull();
  });

  it("disables the BTC withdraw for a null balance and no-ops open", () => {
    summaryRef.current = makeSummary({ btcSats: null });

    const { result } = renderHook(() => useWalletBalancesController());
    expect(result.current.canWithdrawBtc).toBe(false);

    act(() => result.current.openBtcWithdraw());
    expect(result.current.withdraw).toBeNull();
  });
});

describe("depositTargetFor", () => {
  const addrs = { p2wpkh: "bc1qseg", p2tr: "bc1ptap" };

  it("routes Kontor/ordinal assets to Taproot", () => {
    for (const type of ["ordinal", "kontor-nft", "kor"] as const) {
      expect(depositTargetFor(type, addrs)).toEqual({
        label: "Taproot (P2TR)",
        address: "bc1ptap",
      });
    }
  });

  it("routes everything else to Segwit", () => {
    expect(depositTargetFor("counterparty", addrs)).toEqual({
      label: "Segwit (P2WPKH)",
      address: "bc1qseg",
    });
    expect(depositTargetFor("btc", addrs)).toEqual({
      label: "Segwit (P2WPKH)",
      address: "bc1qseg",
    });
  });

  it("falls back to Segwit address when Taproot is missing", () => {
    expect(depositTargetFor("ordinal", { p2wpkh: "bc1qonly" })).toEqual({
      label: "Taproot (P2TR)",
      address: "bc1qonly",
    });
  });
});

describe("assetDepositLabel", () => {
  it("names each owned-asset type", () => {
    expect(assetDepositLabel(PEPE)).toBe("PEPE");
    expect(
      assetDepositLabel({
        type: "zeld",
        address: "a",
        balance: 1n,
        quantityNormalized: "1",
        divisible: true,
      }),
    ).toBe("ZELD");
    expect(assetDepositLabel({ type: "kor", address: "a", amount: "1" })).toBe(
      "KOR",
    );
    expect(assetDepositLabel(NFT)).toBe("NFT");
    expect(assetDepositLabel(ORD)).toBe("Inscription");
  });
});

describe("otherLabel", () => {
  it("labels counterparty, NFT, ordinal, and the default", () => {
    expect(otherLabel(PEPE)).toEqual({ name: "PEPE", sub: "42" });
    expect(otherLabel(NFT).name).toMatch(/^NFT /);
    expect(otherLabel(NFT).sub).toBeNull();
    expect(otherLabel(ORD).name).toBe("Inscription");
    expect(otherLabel(ORD).sub).not.toBeNull();
    expect(otherLabel({ type: "kor", address: "a", amount: "1" })).toEqual({
      name: "",
      sub: null,
    });
  });
});

describe("withdrawTitle", () => {
  it("titles every withdraw target type", () => {
    expect(withdrawTitle({ type: "btc", balanceSats: null })).toBe("BTC");
    expect(withdrawTitle(PEPE)).toBe("PEPE");
    expect(
      withdrawTitle({
        type: "zeld",
        address: "a",
        balance: 1n,
        quantityNormalized: "1",
        divisible: true,
      }),
    ).toBe("ZELD");
    expect(withdrawTitle({ type: "kor", address: "a", amount: "1" })).toBe("KOR");
    expect(withdrawTitle(ORD)).toBe("Ordinal");
    expect(withdrawTitle(NFT)).toBe("NFT");
  });
});

describe("withdrawKey", () => {
  it("keys BTC as 'btc' and assets by their asset key", () => {
    expect(withdrawKey({ type: "btc", balanceSats: null })).toBe("btc");
    expect(withdrawKey(PEPE)).toBe("cp:bc1qwallet:PEPE");
  });
});

describe("tokenDepositType", () => {
  it("maps headline symbols to deposit types", () => {
    expect(tokenDepositType("XCP")).toBe("counterparty");
    expect(tokenDepositType("KOR")).toBe("kor");
    expect(tokenDepositType("ZELD")).toBe("zeld");
  });
});
