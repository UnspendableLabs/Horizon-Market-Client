// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, type CtxRef } from "../hook-test-utils.js";
import type { AssetOption, UseAssetsResult } from "../hooks/useAssets.js";
import type { UseSellOrderResult } from "../hooks/useSellOrder.js";
import { useSellOrderFormController } from "./useSellOrderFormController.js";

const { ctxRef, sellOrderRef, assetsRef } = vi.hoisted(() => ({
  ctxRef: { current: null } as CtxRef,
  sellOrderRef: { current: null } as { current: UseSellOrderResult | null },
  assetsRef: { current: null } as { current: UseAssetsResult | null },
}));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));
vi.mock("../hooks/useSellOrder.js", () => ({
  useSellOrder: () => sellOrderRef.current,
}));
vi.mock("../hooks/useAssets.js", () => ({ useAssets: () => assetsRef.current }));

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
    lastFetchedAt: null,
    isFetching: false,
    refresh: vi.fn(),
    ...o,
  };
}

function makeSellOrder(
  o: Partial<UseSellOrderResult> = {},
): UseSellOrderResult {
  return {
    step: "form",
    formValues: { asset: null, quantity: "", priceSats: "" },
    setFormValues: vi.fn(),
    submitForm: vi.fn(),
    confirmAndSell: vi.fn(),
    goBack: vi.fn(),
    retry: vi.fn(),
    reset: vi.fn(),
    steps: [],
    totalSteps: null,
    status: "idle",
    isSubmitting: false,
    result: null,
    error: null,
    ...o,
  };
}

const xcp = (balance: bigint, quantityNormalized = "5"): AssetOption => ({
  type: "counterparty",
  assetName: "XCP",
  address: "bc1qwallet",
  balance,
  quantityNormalized,
  divisible: true,
});
const PEPE: AssetOption = {
  type: "counterparty",
  assetName: "PEPE",
  address: "bc1qwallet",
  balance: 100n,
  quantityNormalized: "100",
  divisible: false,
};
const ZELD_OPT: AssetOption = {
  type: "zeld",
  address: "bc1qwallet",
  balance: 5n,
  quantityNormalized: "5",
  divisible: true,
};
const KOR_OPT: AssetOption = { type: "kor", address: "bc1pwallet", amount: "3" };
const NFT: AssetOption = {
  type: "kontor-nft",
  nftId: "nft-1234567890abcdef",
  contractAddress: "0xc",
  address: "bc1pwallet",
};
const ORD: AssetOption = {
  type: "ordinal",
  inscriptionId: "insc-abc",
  utxoId: "txid:0",
  address: "bc1pwallet",
};

describe("useSellOrderFormController", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx();
    sellOrderRef.current = makeSellOrder();
    assetsRef.current = makeAssets();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── passthrough + derived flags ──────────────────────────────────────────

  it("forwards the underlying sell-order state and balance controls", () => {
    const refresh = vi.fn();
    sellOrderRef.current = makeSellOrder({ step: "confirm", status: "loading" });
    assetsRef.current = makeAssets({
      lastFetchedAt: 777,
      isFetching: true,
      refresh,
    });

    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.step).toBe("confirm");
    expect(result.current.status).toBe("loading");
    expect(result.current.lastFetchedAt).toBe(777);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.refresh).toBe(refresh);
    expect(result.current.assets).toBe(assetsRef.current);
  });

  it("shows the quantity field for fungibles but not 1-of-1 assets", () => {
    sellOrderRef.current = makeSellOrder({
      formValues: { asset: xcp(50n), quantity: "", priceSats: "" },
    });
    const { result: r1 } = renderHook(() => useSellOrderFormController());
    expect(r1.current.showQuantity).toBe(true);

    sellOrderRef.current = makeSellOrder({
      formValues: { asset: NFT, quantity: "", priceSats: "" },
    });
    const { result: r2 } = renderHook(() => useSellOrderFormController());
    expect(r2.current.showQuantity).toBe(false);
  });

  it("disables submit for an invalid form and enables it for a valid one", () => {
    sellOrderRef.current = makeSellOrder({
      formValues: { asset: null, quantity: "", priceSats: "" },
    });
    const { result: invalid } = renderHook(() => useSellOrderFormController());
    expect(invalid.current.submitDisabled).toBe(true);

    sellOrderRef.current = makeSellOrder({
      formValues: {
        asset: xcp(1_000_000_000n, "10"),
        quantity: "5",
        priceSats: "1000",
      },
    });
    const { result: valid } = renderHook(() => useSellOrderFormController());
    expect(valid.current.submitDisabled).toBe(false);
  });

  it("derives maxQuantity from the selected fungible's balance", () => {
    sellOrderRef.current = makeSellOrder({
      formValues: { asset: xcp(50n, "10"), quantity: "", priceSats: "" },
    });
    const { result } = renderHook(() => useSellOrderFormController());
    expect(result.current.maxQuantity).toBe("10");
  });

  it("has no maxQuantity for a 1-of-1 asset, a blank balance, or no selection", () => {
    sellOrderRef.current = makeSellOrder({
      formValues: { asset: ORD, quantity: "", priceSats: "" },
    });
    expect(
      renderHook(() => useSellOrderFormController()).result.current.maxQuantity,
    ).toBeNull();

    sellOrderRef.current = makeSellOrder({
      formValues: { asset: xcp(50n, ""), quantity: "", priceSats: "" },
    });
    expect(
      renderHook(() => useSellOrderFormController()).result.current.maxQuantity,
    ).toBeNull();

    sellOrderRef.current = makeSellOrder({
      formValues: { asset: null, quantity: "", priceSats: "" },
    });
    expect(
      renderHook(() => useSellOrderFormController()).result.current.maxQuantity,
    ).toBeNull();
  });

  // ─── placeholder ──────────────────────────────────────────────────────────

  it("picks the asset placeholder for loading / empty / ready", () => {
    assetsRef.current = makeAssets({ isFetching: true, allAssets: [] });
    expect(
      renderHook(() => useSellOrderFormController()).result.current
        .assetPlaceholder,
    ).toBe("Loading your assets…");

    assetsRef.current = makeAssets({ isFetching: false, isEmpty: true });
    expect(
      renderHook(() => useSellOrderFormController()).result.current
        .assetPlaceholder,
    ).toBe("No assets to sell");

    assetsRef.current = makeAssets({ allAssets: [PEPE], isEmpty: false });
    expect(
      renderHook(() => useSellOrderFormController()).result.current
        .assetPlaceholder,
    ).toBe("Select an asset…");
  });

  // ─── non-fatal errors ─────────────────────────────────────────────────────

  it("formats per-group non-fatal balance errors", () => {
    assetsRef.current = makeAssets({
      errors: {
        counterparty: new Error("cp down"),
        zeld: new Error("zeld down"),
        ordinals: new Error("ord down"),
        kontor: new Error("kor down"),
      },
    });
    const { result } = renderHook(() => useSellOrderFormController());
    expect(result.current.nonFatalErrors).toEqual([
      "Counterparty: cp down",
      "ZELD: zeld down",
      "Ordinals: ord down",
      "Kontor: kor down",
    ]);
  });

  it("returns no non-fatal errors when all groups loaded cleanly", () => {
    const { result } = renderHook(() => useSellOrderFormController());
    expect(result.current.nonFatalErrors).toEqual([]);
  });

  // ─── asset groups ─────────────────────────────────────────────────────────

  it("groups + orders sellable assets, dropping empty groups", () => {
    assetsRef.current = makeAssets({
      counterpartyAssets: [PEPE, xcp(50n)],
      zeldAssets: [ZELD_OPT],
      korAssets: [KOR_OPT],
      kontorNfts: [NFT],
      ordinals: [ORD],
    });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.assetGroups.map((g) => g.label)).toEqual([
      "Counterparty",
      "ZELD",
      "Kontor",
      "Ordinals",
    ]);
    // XCP pinned first in Counterparty; KOR pinned first in the merged Kontor group.
    const cp = result.current.assetGroups[0].options[0] as AssetOption;
    expect(cp.type === "counterparty" && cp.assetName).toBe("XCP");
    expect(result.current.assetGroups[2].options[0].type).toBe("kor");
  });

  it("returns no asset groups when nothing is owned", () => {
    const { result } = renderHook(() => useSellOrderFormController());
    expect(result.current.assetGroups).toEqual([]);
  });

  // ─── selection reconciliation effect ──────────────────────────────────────

  it("re-points the selection at a fresh option with the same key", () => {
    const stale = xcp(5n, "5");
    const fresh = xcp(10n, "10"); // same key (cp:bc1qwallet:XCP), new object
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "form",
      formValues: { asset: stale, quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({ allAssets: [fresh], lastFetchedAt: 1 });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).toHaveBeenCalledWith({ asset: fresh });
  });

  it("does not re-point when the selected option is already the fresh one", () => {
    const selected = xcp(5n, "5");
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "form",
      formValues: { asset: selected, quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({ allAssets: [selected], lastFetchedAt: 1 });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).not.toHaveBeenCalled();
  });

  it("clears a stale selection once balances have loaded and it is gone", () => {
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "form",
      formValues: { asset: xcp(5n), quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({
      allAssets: [],
      lastFetchedAt: 123,
      isFetching: false,
    });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).toHaveBeenCalledWith({ asset: null });
  });

  it("does not clear a pre-selected asset before the first balances fetch", () => {
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "form",
      formValues: { asset: xcp(5n), quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({ allAssets: [], lastFetchedAt: null });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).not.toHaveBeenCalled();
  });

  it("does not reconcile off the form step", () => {
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "confirm",
      formValues: { asset: xcp(5n), quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({ allAssets: [xcp(9n)], lastFetchedAt: 1 });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).not.toHaveBeenCalled();
  });

  it("does not reconcile when nothing is selected", () => {
    const setFormValues = vi.fn();
    sellOrderRef.current = makeSellOrder({
      step: "form",
      formValues: { asset: null, quantity: "", priceSats: "" },
      setFormValues,
    });
    assetsRef.current = makeAssets({ allAssets: [xcp(9n)], lastFetchedAt: 1 });

    renderHook(() => useSellOrderFormController());
    expect(setFormValues).not.toHaveBeenCalled();
  });

  // ─── result view ──────────────────────────────────────────────────────────

  it("has an empty result view when not on a successful result", () => {
    sellOrderRef.current = makeSellOrder({ status: "idle", result: null });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.resultView).toEqual({
      pendingConfirmation: false,
      trackTxs: [],
      successMessage: undefined,
    });
  });

  it("marks a freshly broadcast listing pending and links each tx distinctly", () => {
    sellOrderRef.current = makeSellOrder({
      status: "success",
      result: {
        swap: {} as never,
        created: true,
        transactions: [
          { txid: "aaa", kind: "asset" },
          { txid: "bbb", kind: "fee" },
        ],
      },
    });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.resultView.pendingConfirmation).toBe(true);
    expect(result.current.resultView.successMessage).toBe("Sell order submitted!");
    expect(result.current.resultView.trackTxs).toEqual([
      { url: "https://mempool.space/tx/aaa", label: "Track the attach transaction →" },
      { url: "https://mempool.space/tx/bbb", label: "Track the fee payment →" },
    ]);
  });

  it("reports a live listing with no broadcast transactions", () => {
    sellOrderRef.current = makeSellOrder({
      status: "success",
      result: { swap: {} as never, created: true, transactions: [] },
    });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.resultView.pendingConfirmation).toBe(false);
    expect(result.current.resultView.trackTxs).toEqual([]);
    expect(result.current.resultView.successMessage).toBe("Your listing is live!");
  });

  it("uses the generic single-tx label for a fee-only listing", () => {
    sellOrderRef.current = makeSellOrder({
      status: "success",
      result: {
        swap: {} as never,
        created: true,
        transactions: [{ txid: "ccc", kind: "fee" }],
      },
    });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.resultView.pendingConfirmation).toBe(false);
    expect(result.current.resultView.successMessage).toBe("Your listing is live!");
    expect(result.current.resultView.trackTxs).toEqual([
      { url: "https://mempool.space/tx/ccc", label: "Track it on mempool.space →" },
    ]);
  });

  it("reports an already-existing listing with no changes", () => {
    sellOrderRef.current = makeSellOrder({
      status: "success",
      result: {
        swap: {} as never,
        created: false,
        transactions: [{ txid: "ddd", kind: "asset" }],
      },
    });
    const { result } = renderHook(() => useSellOrderFormController());

    expect(result.current.resultView.pendingConfirmation).toBe(false);
    expect(result.current.resultView.successMessage).toBe(
      "Listing already exists (no changes).",
    );
    expect(result.current.resultView.trackTxs).toHaveLength(1);
  });

  it("drops transactions with no txid from the track links", () => {
    sellOrderRef.current = makeSellOrder({
      status: "success",
      result: {
        swap: {} as never,
        created: true,
        transactions: [
          { txid: "", kind: "asset" },
          { txid: "eee", kind: "fee" },
        ],
      },
    });
    const { result } = renderHook(() => useSellOrderFormController());

    // An asset tx still exists (just unlinkable) → the listing is pending.
    expect(result.current.resultView.pendingConfirmation).toBe(true);
    expect(result.current.resultView.trackTxs).toEqual([
      { url: "https://mempool.space/tx/eee", label: "Track it on mempool.space →" },
    ]);
  });
});
