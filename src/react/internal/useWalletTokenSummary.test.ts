// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, type CtxRef } from "../hook-test-utils.js";
import type { AssetOption } from "../hooks/useAssets.js";
import type { UseAssetsResult } from "../hooks/useAssets.js";
import type { UseBtcBalanceResult } from "../hooks/useBtcBalance.js";
import {
  tokenAmountText,
  tokenAmountTitle,
  useWalletTokenSummary,
} from "./useWalletTokenSummary.js";

const { ctxRef, assetsRef, btcRef } = vi.hoisted(() => ({
  ctxRef: { current: null } as CtxRef,
  assetsRef: { current: null } as { current: UseAssetsResult | null },
  btcRef: { current: null } as { current: UseBtcBalanceResult | null },
}));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));
vi.mock("../hooks/useAssets.js", () => ({ useAssets: () => assetsRef.current }));
vi.mock("../hooks/useBtcBalance.js", () => ({
  useBtcBalance: () => btcRef.current,
}));

function makeAssets(o: Partial<UseAssetsResult> = {}): UseAssetsResult {
  return {
    counterpartyAssets: [],
    zeldAssets: [],
    ordinals: [],
    korAssets: [],
    kontorNfts: [],
    allAssets: [],
    isEmpty: false,
    errors: { counterparty: null, zeld: null, ordinals: null, kontor: null },
    sources: {
      counterparty: { status: "ok" },
      zeld: { status: "ok" },
      ordinals: { status: "ok" },
      kontor: { status: "ok" },
    },
    lastFetchedAt: null,
    isFetching: false,
    refresh: vi.fn(),
    ...o,
  };
}

function makeBtc(o: Partial<UseBtcBalanceResult> = {}): UseBtcBalanceResult {
  return { sats: null, loading: false, error: null, refresh: vi.fn(), ...o };
}

function xcp(balance: bigint, quantityNormalized = "1"): AssetOption {
  return {
    type: "counterparty",
    assetName: "XCP",
    address: "bc1qwallet",
    balance,
    quantityNormalized,
    divisible: true,
  };
}

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
  inscriptionId: "insc-abc",
  utxoId: "txid:0",
  address: "bc1pwallet",
};

describe("useWalletTokenSummary", () => {
  beforeEach(() => {
    // Kontor configured (and ZELD via makeCtx's mainnet default) so the full
    // BTC/XCP/KOR/ZELD headline set is exercised; the visibility tests at the
    // bottom cover the rows disappearing with their protocol's config.
    ctxRef.current = makeCtx({ kontorNetwork: "signet" });
    assetsRef.current = makeAssets();
    btcRef.current = makeBtc();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows zero headline balances and no holdings for an empty, loading wallet", () => {
    assetsRef.current = makeAssets({ isFetching: false, lastFetchedAt: null });
    btcRef.current = makeBtc({ sats: null, loading: true });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.btc.amount).toBeNull();
    expect(result.current.btcSats).toBeNull();
    const [xcpLine, korLine, zeldLine] = result.current.primary;
    expect(xcpLine).toMatchObject({ symbol: "XCP", amount: "0", sellAsset: null });
    expect(korLine).toMatchObject({ symbol: "KOR", amount: "0", sellAsset: null });
    expect(zeldLine).toMatchObject({ symbol: "ZELD", amount: "0", sellAsset: null });
    expect(result.current.others).toEqual([]);
    expect(result.current.tokens).toHaveLength(4);
    expect(result.current.tokens[0].symbol).toBe("BTC");
    expect(result.current.loading).toBe(true);
    expect(result.current.isFetching).toBe(true);
  });

  it("aggregates headline tokens, sell pre-selection, and other holdings", () => {
    // Ordered mid, large, small so largestBalance exercises both its "grow" and
    // "keep the current best" reduce branches.
    const xcpMid = xcp(150_000_000n, "1.5");
    const xcpLarge = xcp(200_000_000n, "2");
    const xcpSmall = xcp(100_000_000n, "1");
    const zeldOpt: AssetOption = {
      type: "zeld",
      address: "bc1qwallet",
      balance: 50_000_000n,
      quantityNormalized: "0.5",
      divisible: true,
    };
    const korOpt: AssetOption = {
      type: "kor",
      address: "bc1pwallet",
      amount: "12.5",
    };

    assetsRef.current = makeAssets({
      counterpartyAssets: [xcpMid, xcpLarge, xcpSmall, PEPE],
      zeldAssets: [zeldOpt],
      korAssets: [korOpt],
      kontorNfts: [NFT],
      ordinals: [ORD],
      lastFetchedAt: 1000,
      isFetching: false,
    });
    btcRef.current = makeBtc({ sats: 250_000_000n, loading: false });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.btc.amount).toBe("2.5");
    expect(result.current.btcSats).toBe(250_000_000n);

    const [xcpLine, korLine, zeldLine] = result.current.primary;
    // 1.5 + 2 + 1 = 4.5 XCP; largest-balance option is the sell pre-selection.
    expect(xcpLine.amount).toBe("4.5");
    expect(xcpLine.sellAsset).toBe(xcpLarge);
    expect(xcpLine.asset).toMatchObject({ type: "counterparty", assetName: "XCP" });
    expect(korLine.amount).toBe("12.5");
    expect(korLine.sellAsset).toBe(korOpt);
    expect(zeldLine.amount).toBe("0.5");
    expect(zeldLine.sellAsset).toBe(zeldOpt);

    // others = non-XCP counterparty + kontor NFTs + ordinals.
    expect(result.current.others).toEqual([PEPE, NFT, ORD]);
    expect(result.current.loading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.lastFetchedAt).toBe(1000);
  });

  it("uses an empty holding address when the wallet is disconnected", () => {
    ctxRef.current = makeCtx({ addresses: null });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.primary[0].asset).toMatchObject({ address: "" });
  });

  it("is loading while assets are fetching before the first resolve", () => {
    assetsRef.current = makeAssets({ isFetching: true, lastFetchedAt: null });
    btcRef.current = makeBtc({ sats: 1n, loading: false });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.loading).toBe(true);
    expect(result.current.isFetching).toBe(true);
  });

  it("is not loading once a fetch has completed even if a refresh is in flight", () => {
    assetsRef.current = makeAssets({ isFetching: true, lastFetchedAt: 42 });
    btcRef.current = makeBtc({ sats: 1n, loading: false });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.loading).toBe(false);
    expect(result.current.isFetching).toBe(true);
  });

  it("stays loading while BTC is loading regardless of asset state", () => {
    assetsRef.current = makeAssets({ isFetching: false, lastFetchedAt: 42 });
    btcRef.current = makeBtc({ sats: null, loading: true });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.loading).toBe(true);
    expect(result.current.isFetching).toBe(true);
  });

  it("blanks a headline amount whose source failed instead of showing 0", () => {
    const cpError = new Error("indexer down");
    const kontorError = new Error("kontor down");
    assetsRef.current = makeAssets({
      // A failed source contributes NO options, so the computed amount would be
      // a "0" that means "we couldn't look" — exactly the claim to avoid.
      errors: {
        counterparty: cpError,
        zeld: null,
        ordinals: null,
        kontor: kontorError,
      },
    });
    btcRef.current = makeBtc({ sats: 1n });

    const { result } = renderHook(() => useWalletTokenSummary());
    const bySymbol = Object.fromEntries(
      result.current.tokens.map((l) => [l.symbol, l]),
    );

    expect(bySymbol.XCP.amount).toBeNull();
    expect(bySymbol.XCP.error).toBe(cpError);
    expect(bySymbol.KOR.amount).toBeNull();
    expect(bySymbol.KOR.error).toBe(kontorError);
    // Sources that answered keep their real "0" — it means the wallet holds none.
    expect(bySymbol.ZELD.amount).toBe("0");
    expect(bySymbol.ZELD.error).toBeNull();
    expect(bySymbol.BTC.error).toBeNull();
  });

  it("carries the BTC read's own failure on the BTC line", () => {
    const btcError = new Error("mempool unreachable");
    btcRef.current = makeBtc({ sats: null, error: btcError });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.btc.error).toBe(btcError);
    expect(result.current.btc.amount).toBeNull();
  });

  it("renders a failed amount as an em dash, a pending one as an ellipsis", () => {
    const line = {
      symbol: "XCP" as const,
      amount: null,
      error: new Error("indexer down"),
      asset: null,
      sellAsset: null,
    };

    expect(tokenAmountText(line)).toBe("—");
    expect(tokenAmountTitle(line)).toBe(
      "Couldn't load your XCP balance: indexer down",
    );
    expect(tokenAmountText({ ...line, error: null })).toBe("…");
    expect(tokenAmountText({ ...line, amount: "0", error: null })).toBe("0");
    expect(tokenAmountTitle({ ...line, amount: "0", error: null })).toBe(
      "0 XCP",
    );
  });

  it("drops the KOR row when Kontor isn't configured", () => {
    // A mainnet app today: no kontorNetwork → no KOR headline row (not a "0").
    ctxRef.current = makeCtx({ kontorNetwork: undefined });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.primary.map((l) => l.symbol)).toEqual(["XCP", "ZELD"]);
    expect(result.current.tokens.map((l) => l.symbol)).toEqual([
      "BTC",
      "XCP",
      "ZELD",
    ]);
  });

  it("drops the ZELD row when no ZeldHash API resolves", () => {
    // A signet app today: no zeldApiBaseUrl → no ZELD headline row.
    ctxRef.current = makeCtx({
      kontorNetwork: "signet",
      zeldApiBaseUrl: undefined,
    });

    const { result } = renderHook(() => useWalletTokenSummary());

    expect(result.current.primary.map((l) => l.symbol)).toEqual(["XCP", "KOR"]);
  });

  it("refresh() re-fetches both BTC and owned balances", () => {
    const assetsRefresh = vi.fn();
    const btcRefresh = vi.fn();
    assetsRef.current = makeAssets({ refresh: assetsRefresh });
    btcRef.current = makeBtc({ refresh: btcRefresh });

    const { result } = renderHook(() => useWalletTokenSummary());
    act(() => {
      result.current.refresh();
    });

    expect(assetsRefresh).toHaveBeenCalledTimes(1);
    expect(btcRefresh).toHaveBeenCalledTimes(1);
  });
});
