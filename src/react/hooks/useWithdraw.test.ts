// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, act, waitFor, type CtxRef } from "../hook-test-utils.js";
import type { HorizonMarketContextValue } from "../context.js";
import type { PreparedSend } from "../../send/types.js";
import type { FeeEstimates } from "./useFeeEstimates.js";
import {
  useWithdraw,
  WITHDRAW_FEE_OPTIONS,
  WITHDRAW_FEE_LABELS,
  type WithdrawTarget,
} from "./useWithdraw.js";

// The withdraw hook composes over `useHorizonMarket()` (for `client.prepareSend`)
// plus four sub-hooks that each do their own network I/O + module-level caching.
// Mock the sub-hooks directly so every test has deterministic estimates / prices
// / owned-assets / Kontor-fee inputs, and drive the send pipeline through the
// mocked `client.prepareSend` (which is what the hook actually calls). The pure
// helpers (estimateKontorMinerFee, format.ts) stay real.
const { ctxRef, assetsRef, feeRef, pricesRef, kontorFeeRef } = vi.hoisted(() => ({
  ctxRef: { current: null } as CtxRef,
  assetsRef: {
    current: { ordinals: [] as unknown[], refresh: (() => {}) as () => void },
  },
  feeRef: { current: { estimates: null as FeeEstimates | null } },
  pricesRef: { current: { btcUsd: null as number | null } },
  kontorFeeRef: {
    current: {
      revealVsize: null as number | null,
      calibrated: false,
      loading: false,
    },
  },
}));

vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));
vi.mock("./useAssets.js", () => ({ useAssets: () => assetsRef.current }));
vi.mock("./useFeeEstimates.js", () => ({ useFeeEstimates: () => feeRef.current }));
vi.mock("./usePrices.js", () => ({ usePrices: () => pricesRef.current }));
vi.mock("../internal/useKontorMinerFee.js", () => ({
  useKontorMinerFee: () => kontorFeeRef.current,
}));

// --- fixtures -------------------------------------------------------------

function normalEstimates(): FeeEstimates {
  return {
    fastestFee: 20,
    halfHourFee: 10,
    hourFee: 5,
    economyFee: 2,
    minimumFee: 1,
  };
}

function btcTarget(balanceSats: bigint | null = 100_000_000n): WithdrawTarget {
  return { type: "btc", balanceSats };
}

function counterpartyTarget(
  over: Partial<{
    assetName: string;
    assetLongname: string | null;
    address: string;
    balance: bigint;
    quantityNormalized: string;
    divisible: boolean;
  }> = {},
): WithdrawTarget {
  return {
    type: "counterparty",
    assetName: over.assetName ?? "XCP",
    assetLongname: over.assetLongname ?? null,
    address: over.address ?? "bc1qhold",
    balance: over.balance ?? 500_000_000n,
    quantityNormalized: over.quantityNormalized ?? "5",
    divisible: over.divisible ?? true,
  };
}

function zeldTarget(
  over: Partial<{ balance: bigint; quantityNormalized: string }> = {},
): WithdrawTarget {
  return {
    type: "zeld",
    address: "bc1qhold",
    balance: over.balance ?? 1_000_000_000n,
    quantityNormalized: over.quantityNormalized ?? "10",
    divisible: true,
  };
}

function ordinalTarget(
  inscriptionId = "inscriptionidwhichisreallylong0000",
): WithdrawTarget {
  return {
    type: "ordinal",
    inscriptionId,
    utxoId: "aaaa:0",
    address: "bc1phold",
  };
}

function korTarget(amount = "100.5"): WithdrawTarget {
  return { type: "kor", address: "bc1phold", amount };
}

function nftTarget(nftId = "nftidwhichisreallyquitelong000000"): WithdrawTarget {
  return {
    type: "kontor-nft",
    nftId,
    contractAddress: "0xcontract",
    address: "bc1phold",
  };
}

/** A composed-and-signed send whose broadcast resolves to `{ txid }`. */
function makePrepared(
  over: { feeSats?: bigint | null; txid?: string; kind?: PreparedSend["kind"] } = {},
) {
  const broadcast = vi.fn(async () => ({ txid: over.txid ?? "txid-default" }));
  const prepared = {
    kind: over.kind ?? "btc",
    // `?? 250n` would clobber an intentional `null` (Kontor), so branch explicitly.
    feeSats: over.feeSats === undefined ? 250n : over.feeSats,
    broadcast,
  } as PreparedSend;
  return { prepared, broadcast };
}

/** Point the mocked context at a `prepareSend` and return the spy. */
function withPrepareSend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepareSend: (...args: any[]) => unknown,
  extra: Partial<HorizonMarketContextValue> = {},
) {
  ctxRef.current = makeCtx({
    client: { prepareSend } as unknown as HorizonMarketContextValue["client"],
    ...extra,
  });
  return prepareSend;
}

type HookResult = ReturnType<typeof renderHook<ReturnType<typeof useWithdraw>, unknown>>["result"];

async function fill(
  result: HookResult,
  values: { destination?: string; quantity?: string },
) {
  await act(async () => {
    result.current.setFormValues(values);
  });
}

async function reachConfirm(
  result: HookResult,
  values: { destination?: string; quantity?: string } = {},
) {
  await fill(result, { destination: "bc1qdest", quantity: "0.001", ...values });
  await act(async () => {
    result.current.submitForm();
  });
  await waitFor(() => expect(result.current.step).toBe("confirm"));
}

// --- tests ----------------------------------------------------------------

describe("useWithdraw", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx({
      client: {
        prepareSend: vi.fn(),
      } as unknown as HorizonMarketContextValue["client"],
    });
    assetsRef.current = { ordinals: [], refresh: vi.fn() };
    feeRef.current = { estimates: normalEstimates() };
    pricesRef.current = { btcUsd: null };
    kontorFeeRef.current = { revealVsize: null, calibrated: false, loading: false };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("derived view for the form", () => {
    it("exposes BTC labels, flags and available balance", () => {
      const { result } = renderHook(() =>
        useWithdraw({ target: btcTarget(123_456_789n) }),
      );
      expect(result.current.kind).toBe("btc");
      expect(result.current.isKontor).toBe(false);
      expect(result.current.needsQuantity).toBe(true);
      expect(result.current.assetLabel).toBe("BTC");
      expect(result.current.destinationLabel).toBe("Destination address");
      expect(result.current.destinationPlaceholder).toBe("bc1…");
      expect(result.current.availableDisplay).toBe("1.23456789");
      // Initial review fee for BTC before composing: unknown.
      expect(result.current.reviewFee).toEqual({
        exact: false,
        sats: null,
        usd: null,
      });
    });

    it("renders a zero sub-line and null balance for an unknown BTC balance", () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget(null) }));
      expect(result.current.availableDisplay).toBeNull();
      expect(result.current.withdrawingDisplay).toEqual({
        name: "BTC",
        sub: "0 BTC",
      });
    });

    it("labels and available balances for each fungible kind", () => {
      const cp = renderHook(() =>
        useWithdraw({
          target: counterpartyTarget({
            assetName: "PEPECASH",
            quantityNormalized: "42",
          }),
        }),
      );
      expect(cp.result.current.assetLabel).toBe("PEPECASH");
      expect(cp.result.current.availableDisplay).toBe("42");
      expect(cp.result.current.withdrawingDisplay).toEqual({
        name: "PEPECASH",
        sub: " units",
      });

      const zeld = renderHook(() =>
        useWithdraw({ target: zeldTarget({ quantityNormalized: "7.5" }) }),
      );
      expect(zeld.result.current.assetLabel).toBe("ZELD");
      expect(zeld.result.current.availableDisplay).toBe("7.5");

      const kor = renderHook(() => useWithdraw({ target: korTarget("100.5") }));
      expect(kor.result.current.assetLabel).toBe("KOR");
      expect(kor.result.current.availableDisplay).toBe("100.5");
    });

    it("labels a subasset by its long name, not the numeric A… name", () => {
      const { result } = renderHook(() =>
        useWithdraw({
          target: counterpartyTarget({
            assetName: "A4950153011122931022",
            assetLongname: "PEPENARDO.CARD",
            quantityNormalized: "3",
          }),
        }),
      );
      expect(result.current.assetLabel).toBe("PEPENARDO.CARD");
      expect(result.current.withdrawingDisplay.name).toBe("PEPENARDO.CARD");
    });

    it("shortens a long ordinal id but keeps a short one, and hides quantity", () => {
      const long = renderHook(() =>
        useWithdraw({ target: ordinalTarget("0123456789abcdefghij") }),
      );
      expect(long.result.current.assetLabel).toBe("01234567…efghij");
      expect(long.result.current.needsQuantity).toBe(false);
      expect(long.result.current.availableDisplay).toBeNull();

      const short = renderHook(() =>
        useWithdraw({ target: ordinalTarget("short") }),
      );
      expect(short.result.current.assetLabel).toBe("short");
    });

    it("uses P2TR wording and no quantity for Kontor NFT targets", () => {
      const { result } = renderHook(() => useWithdraw({ target: nftTarget("abc") }));
      expect(result.current.kind).toBe("kontor-nft");
      expect(result.current.isKontor).toBe(true);
      expect(result.current.needsQuantity).toBe(false);
      expect(result.current.assetLabel).toBe("abc");
      expect(result.current.availableDisplay).toBeNull();
      expect(result.current.destinationLabel).toBe("Recipient (P2TR address)");
      expect(result.current.destinationPlaceholder).toBe("tb1p…");
      expect(result.current.withdrawingDisplay).toEqual({
        name: "NFT abc",
        sub: null,
      });
    });
  });

  describe("fee-rate presets", () => {
    it("maps each preset to a rate and mirrors it in rateFor", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      expect(result.current.feeOption).toBe("normal");
      expect(result.current.feeRate).toBe(10); // halfHourFee
      expect(result.current.feeEstimates).toBe(feeRef.current.estimates);
      expect(result.current.rateFor("fast")).toBe(20);
      expect(result.current.rateFor("normal")).toBe(10);
      expect(result.current.rateFor("slow")).toBe(5);

      await act(async () => result.current.setFeeOption("fast"));
      expect(result.current.feeOption).toBe("fast");
      expect(result.current.feeRate).toBe(20); // fastestFee

      await act(async () => result.current.setFeeOption("slow"));
      expect(result.current.feeRate).toBe(5); // hourFee
    });

    it("has a null rate and undefined rateFor without live estimates", () => {
      feeRef.current = { estimates: null };
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      expect(result.current.feeRate).toBeNull();
      expect(result.current.feeEstimates).toBeNull();
      expect(result.current.rateFor("fast")).toBeUndefined();
    });

    it("exposes the preset option list and labels", () => {
      expect(WITHDRAW_FEE_OPTIONS).toEqual(["slow", "normal", "fast"]);
      expect(WITHDRAW_FEE_LABELS).toEqual({
        slow: "Slow",
        normal: "Normal",
        fast: "Fast",
      });
    });
  });

  describe("Kontor miner-fee estimate", () => {
    it("estimates the KOR miner fee at the selected rate (no price → no USD)", () => {
      kontorFeeRef.current = { revealVsize: 227, calibrated: true, loading: false };
      const { result } = renderHook(() => useWithdraw({ target: korTarget() }));
      // (227 reveal + 154 commit) * 10 sat/vB = 3810
      expect(result.current.estimatedFeeSats).toBe(3810);
      expect(result.current.feeEstimateCalibrated).toBe(true);
      expect(result.current.reviewFee).toEqual({
        exact: false,
        sats: 3810,
        usd: null,
      });
    });

    it("adds a USD line when a BTC price is available", () => {
      kontorFeeRef.current = { revealVsize: 227, calibrated: false, loading: false };
      pricesRef.current = { btcUsd: 50_000 };
      const { result } = renderHook(() => useWithdraw({ target: korTarget() }));
      expect(result.current.reviewFee.sats).toBe(3810);
      expect(result.current.reviewFee.usd).toMatch(/^\$/);
      expect(result.current.feeEstimateCalibrated).toBe(false);
    });

    it("has no estimate when the fee rate is unavailable", () => {
      kontorFeeRef.current = { revealVsize: 227, calibrated: true, loading: false };
      feeRef.current = { estimates: null };
      const { result } = renderHook(() => useWithdraw({ target: korTarget() }));
      expect(result.current.estimatedFeeSats).toBeNull();
    });

    it("does not estimate a Kontor fee for a Bitcoin-family target", () => {
      kontorFeeRef.current = { revealVsize: 227, calibrated: true, loading: false };
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      expect(result.current.estimatedFeeSats).toBeNull();
    });
  });

  describe("submitDisabled", () => {
    it("stays disabled until destination and quantity are present", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      expect(result.current.submitDisabled).toBe(true);
      await fill(result, { destination: "bc1qdest" });
      expect(result.current.submitDisabled).toBe(true); // quantity still empty
      await fill(result, { quantity: "0.01" });
      expect(result.current.submitDisabled).toBe(false);
    });

    it("only needs a destination for a 1-of-1 ordinal", async () => {
      const { result } = renderHook(() => useWithdraw({ target: ordinalTarget() }));
      expect(result.current.submitDisabled).toBe(true);
      await fill(result, { destination: "bc1qdest" });
      expect(result.current.submitDisabled).toBe(false);
    });
  });

  describe("setters clear stale errors", () => {
    it("setFormValues merges the patch and clears the error", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await act(async () => {
        result.current.submitForm(); // no destination → error
      });
      expect(result.current.error?.message).toBe("Enter a destination address");
      await fill(result, { destination: "bc1qdest" });
      expect(result.current.error).toBeNull();
      expect(result.current.formValues).toEqual({
        destination: "bc1qdest",
        quantity: "",
      });
    });

    it("setFeeOption clears the error", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await act(async () => result.current.submitForm());
      expect(result.current.error).not.toBeNull();
      await act(async () => result.current.setFeeOption("fast"));
      expect(result.current.error).toBeNull();
    });
  });

  describe("submitForm guard / validation early returns", () => {
    async function expectError(target: WithdrawTarget, values: {
      destination?: string;
      quantity?: string;
    }, message: string) {
      const prepareSend = vi.fn();
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target }));
      await fill(result, values);
      await act(async () => {
        result.current.submitForm();
      });
      expect(result.current.error?.message).toBe(message);
      expect(result.current.step).toBe("form");
      expect(prepareSend).not.toHaveBeenCalled();
    }

    it("rejects an empty destination", async () => {
      await expectError(
        btcTarget(),
        { destination: "  ", quantity: "0.01" },
        "Enter a destination address",
      );
    });

    it("rejects a zero BTC amount", async () => {
      await expectError(
        btcTarget(),
        { destination: "bc1qdest", quantity: "0" },
        "Enter an amount greater than 0",
      );
    });

    it("rejects a malformed amount", async () => {
      await expectError(
        btcTarget(),
        { destination: "bc1qdest", quantity: "abc" },
        "Enter a valid amount",
      );
    });

    it("rejects excess decimal precision", async () => {
      await expectError(
        btcTarget(),
        { destination: "bc1qdest", quantity: "0.000000001" },
        "At most 8 decimal places",
      );
    });

    it("rejects a fractional amount for an indivisible Counterparty asset", async () => {
      await expectError(
        counterpartyTarget({ divisible: false, balance: 10n }),
        { destination: "bc1qdest", quantity: "1.5" },
        "This asset is indivisible — enter a whole number",
      );
    });

    it("rejects a Counterparty amount above the balance", async () => {
      await expectError(
        counterpartyTarget({ balance: 500_000_000n }), // 5 units
        { destination: "bc1qdest", quantity: "6" },
        "Amount exceeds your balance",
      );
    });

    it("rejects a ZELD amount above the balance", async () => {
      await expectError(
        zeldTarget({ balance: 100_000_000n }), // 1 ZELD
        { destination: "bc1qdest", quantity: "2" },
        "Amount exceeds your balance",
      );
    });

    it("rejects an empty KOR amount", async () => {
      await expectError(
        korTarget(),
        { destination: "bc1pdest", quantity: "   " },
        "Enter an amount greater than 0",
      );
    });

    it("rejects a non-positive KOR amount", async () => {
      await expectError(
        korTarget(),
        { destination: "bc1pdest", quantity: "0" },
        "Enter an amount greater than 0",
      );
    });

    it("surfaces CLIENT_NOT_INITIALIZED when no wallet client is present", async () => {
      ctxRef.current = makeCtx({
        client: null as unknown as HorizonMarketContextValue["client"],
      });
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await fill(result, { destination: "bc1qdest", quantity: "0.01" });
      await act(async () => {
        result.current.submitForm();
      });
      expect(result.current.error?.message).toBe(
        "Client not initialized — please log in first",
      );
      expect(result.current.step).toBe("form");
    });
  });

  describe("submitForm composes the send per asset kind", () => {
    it("composes a BTC send and advances to review with the exact fee", async () => {
      const { prepared } = makePrepared({ feeSats: 250n });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      // an owned ordinal must be forwarded as a protected UTXO
      assetsRef.current = {
        ordinals: [
          { type: "ordinal", utxoId: "prot:0", inscriptionId: "x", address: "a" },
        ],
        refresh: vi.fn(),
      };
      pricesRef.current = { btcUsd: 50_000 };

      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result, { destination: "bc1qdest", quantity: "0.001" });

      expect(prepareSend).toHaveBeenCalledWith(
        {
          kind: "btc",
          toAddress: "bc1qdest",
          amountSats: 100_000n,
          satsPerVbyte: 10,
        },
        { protectedUtxoIds: ["prot:0"] },
      );
      expect(result.current.feeSats).toBe(250n);
      expect(result.current.reviewFee).toEqual({
        exact: true,
        sats: 250,
        usd: expect.stringMatching(/^\$/),
      });
    });

    it("composes a divisible Counterparty send", async () => {
      const { prepared } = makePrepared({ feeSats: 300n, kind: "counterparty" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() =>
        useWithdraw({ target: counterpartyTarget({ assetName: "XCP" }) }),
      );
      await reachConfirm(result, { destination: "bc1qdest", quantity: "3" });
      expect(prepareSend).toHaveBeenCalledWith(
        {
          kind: "counterparty",
          fromAddress: "bc1qhold",
          asset: "XCP",
          toAddress: "bc1qdest",
          quantity: 300_000_000n,
          divisible: true,
          satsPerVbyte: 10,
        },
        { protectedUtxoIds: [] },
      );
    });

    it("composes an indivisible Counterparty send with a whole-number quantity", async () => {
      const { prepared } = makePrepared({ feeSats: 300n, kind: "counterparty" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() =>
        useWithdraw({
          target: counterpartyTarget({
            assetName: "RAREPEPE",
            divisible: false,
            balance: 100n,
          }),
        }),
      );
      await reachConfirm(result, { destination: "bc1qdest", quantity: "5" });
      expect(prepareSend).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "counterparty",
          asset: "RAREPEPE",
          quantity: 5n,
          divisible: false,
        }),
        { protectedUtxoIds: [] },
      );
    });

    it("composes a ZELD send", async () => {
      const { prepared } = makePrepared({ feeSats: 200n, kind: "zeld" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: zeldTarget() }));
      await reachConfirm(result, { destination: "bc1qdest", quantity: "2" });
      expect(prepareSend).toHaveBeenCalledWith(
        {
          kind: "zeld",
          fromAddress: "bc1qhold",
          toAddress: "bc1qdest",
          amount: 200_000_000n,
          satsPerVbyte: 10,
        },
        { protectedUtxoIds: [] },
      );
    });

    it("composes an ordinal send (quantity ignored)", async () => {
      const { prepared } = makePrepared({ feeSats: 180n, kind: "ordinal" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: ordinalTarget() }));
      await reachConfirm(result, { destination: "bc1qdest", quantity: "" });
      expect(prepareSend).toHaveBeenCalledWith(
        {
          kind: "ordinal",
          fromAddress: "bc1phold",
          utxoId: "aaaa:0",
          toAddress: "bc1qdest",
          satsPerVbyte: 10,
        },
        { protectedUtxoIds: [] },
      );
      expect(result.current.feeSats).toBe(180n);
    });

    it("composes a KOR send (Kontor fee is not exact)", async () => {
      kontorFeeRef.current = { revealVsize: 227, calibrated: true, loading: false };
      const { prepared } = makePrepared({ feeSats: null, kind: "kor" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: korTarget() }));
      await reachConfirm(result, { destination: "bc1pdest", quantity: "10" });
      expect(prepareSend).toHaveBeenCalledWith(
        { kind: "kor", toAddress: "bc1pdest", amount: "10", satsPerVbyte: 10 },
        { protectedUtxoIds: [] },
      );
      expect(result.current.feeSats).toBeNull();
      // Kontor: review fee remains the estimate, not the composed fee.
      expect(result.current.reviewFee.exact).toBe(false);
      expect(result.current.reviewFee.sats).toBe(3810);
    });

    it("composes a Kontor NFT send", async () => {
      const { prepared } = makePrepared({ feeSats: null, kind: "kontor-nft" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: nftTarget("nft-9") }));
      await reachConfirm(result, { destination: "bc1pdest" });
      expect(prepareSend).toHaveBeenCalledWith(
        {
          kind: "kontor-nft",
          contractAddress: "0xcontract",
          nftId: "nft-9",
          toAddress: "bc1pdest",
          satsPerVbyte: 10,
        },
        { protectedUtxoIds: [] },
      );
    });

    it("falls back to a 1 sat/vByte rate without live estimates", async () => {
      feeRef.current = { estimates: null };
      const { prepared } = makePrepared({ feeSats: 100n });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result, { destination: "bc1qdest", quantity: "0.01" });
      expect(prepareSend).toHaveBeenCalledWith(
        expect.objectContaining({ satsPerVbyte: 1 }),
        { protectedUtxoIds: [] },
      );
    });

    it("marks isPreparing / submitDisabled while composing and ignores a re-submit", async () => {
      let resolvePrepare!: (v: PreparedSend) => void;
      const prepareSend = vi.fn(
        () => new Promise<PreparedSend>((r) => (resolvePrepare = r)),
      );
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await fill(result, { destination: "bc1qdest", quantity: "0.01" });
      await act(async () => {
        result.current.submitForm();
        result.current.submitForm(); // second call is ignored (in flight)
      });
      expect(prepareSend).toHaveBeenCalledTimes(1);
      expect(result.current.isPreparing).toBe(true);
      expect(result.current.submitDisabled).toBe(true);
      await act(async () => {
        resolvePrepare(makePrepared({ feeSats: 100n }).prepared);
      });
      await waitFor(() => expect(result.current.step).toBe("confirm"));
      expect(result.current.isPreparing).toBe(false);
    });

    it("surfaces a compose failure and stays on the form step", async () => {
      const prepareSend = vi.fn().mockRejectedValue(new Error("compose boom"));
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await fill(result, { destination: "bc1qdest", quantity: "0.01" });
      await act(async () => {
        result.current.submitForm();
      });
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.error?.message).toBe("compose boom");
      expect(result.current.step).toBe("form");
      expect(result.current.isPreparing).toBe(false);
    });

    it("wraps a non-Error compose rejection", async () => {
      const prepareSend = vi.fn().mockRejectedValue("string-fail");
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await fill(result, { destination: "bc1qdest", quantity: "0.01" });
      await act(async () => {
        result.current.submitForm();
      });
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.error?.message).toBe("string-fail");
    });
  });

  describe("confirmAndSend broadcast state machine", () => {
    it("broadcasts, reports success and refreshes owned assets", async () => {
      const refresh = vi.fn();
      assetsRef.current = { ordinals: [], refresh };
      const { prepared, broadcast } = makePrepared({ feeSats: 250n, txid: "tx-ok" });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useWithdraw({ target: btcTarget(), onSuccess, onError }),
      );
      await reachConfirm(result);

      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe("success");
      expect(result.current.step).toBe("result");
      expect(result.current.result).toEqual({ txid: "tx-ok" });
      expect(result.current.error).toBeNull();
      expect(onSuccess).toHaveBeenCalledWith("tx-ok");
      expect(onError).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("reports an error result when nothing is composed", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(result.current.status).toBe("error");
      expect(result.current.step).toBe("result");
      expect(result.current.error?.message).toBe(
        "No composed transaction to send — please review again",
      );
    });

    it("reports a broadcast failure and calls onError", async () => {
      const broadcast = vi.fn().mockRejectedValue(new Error("broadcast boom"));
      const prepared = { kind: "btc", feeSats: 250n, broadcast } as PreparedSend;
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useWithdraw({ target: btcTarget(), onSuccess, onError }),
      );
      await reachConfirm(result);
      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(result.current.status).toBe("error");
      expect(result.current.step).toBe("result");
      expect(result.current.error?.message).toBe("broadcast boom");
      expect(result.current.result).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("ignores a second confirm while a broadcast is in flight", async () => {
      let resolveB!: (v: { txid: string }) => void;
      const broadcast = vi.fn(
        () => new Promise<{ txid: string }>((r) => (resolveB = r)),
      );
      const prepared = { kind: "btc", feeSats: 100n, broadcast } as PreparedSend;
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result);
      await act(async () => {
        const p1 = result.current.confirmAndSend();
        const p2 = result.current.confirmAndSend(); // ignored, resolves immediately
        resolveB({ txid: "tx-guard" });
        await Promise.all([p1, p2]);
      });
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(result.current.result?.txid).toBe("tx-guard");
    });
  });

  describe("navigation: goBack / retry / reset", () => {
    it("goBack from review returns to the form and drops the composed tx", async () => {
      const { prepared } = makePrepared({ feeSats: 250n });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result);
      expect(result.current.feeSats).toBe(250n);

      await act(async () => result.current.goBack());
      expect(result.current.step).toBe("form");
      expect(result.current.feeSats).toBeNull();

      // preparedRef was cleared → confirming now yields the "no composed tx" error.
      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(result.current.error?.message).toBe(
        "No composed transaction to send — please review again",
      );
    });

    it("goBack from an error result returns to the form and clears the error", async () => {
      const broadcast = vi.fn().mockRejectedValue(new Error("nope"));
      const prepared = { kind: "btc", feeSats: 1n, broadcast } as PreparedSend;
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result);
      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(result.current.step).toBe("result");

      await act(async () => result.current.goBack());
      expect(result.current.step).toBe("form");
      expect(result.current.error).toBeNull();
    });

    it("goBack is a no-op on the form step", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await act(async () => result.current.goBack());
      expect(result.current.step).toBe("form");
    });

    it("retry from an error re-opens the form", async () => {
      const broadcast = vi.fn().mockRejectedValue(new Error("stale"));
      const prepared = { kind: "btc", feeSats: 1n, broadcast } as PreparedSend;
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await reachConfirm(result);
      await act(async () => {
        await result.current.confirmAndSend();
      });
      expect(result.current.status).toBe("error");

      await act(async () => result.current.retry());
      expect(result.current.step).toBe("form");
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
      expect(result.current.feeSats).toBeNull();
    });

    it("retry is a no-op unless the status is error", async () => {
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await act(async () => result.current.retry());
      expect(result.current.step).toBe("form");
      expect(result.current.status).toBe("idle");
    });

    it("reset restores every field to its default", async () => {
      const { prepared } = makePrepared({ feeSats: 250n });
      const prepareSend = vi.fn().mockResolvedValue(prepared);
      withPrepareSend(prepareSend);
      const { result } = renderHook(() => useWithdraw({ target: btcTarget() }));
      await fill(result, { destination: "bc1qdest", quantity: "0.5" });
      await act(async () => result.current.setFeeOption("fast"));
      await act(async () => {
        result.current.submitForm();
      });
      await waitFor(() => expect(result.current.step).toBe("confirm"));

      await act(async () => result.current.reset());
      expect(result.current.formValues).toEqual({ destination: "", quantity: "" });
      expect(result.current.feeOption).toBe("normal");
      expect(result.current.step).toBe("form");
      expect(result.current.status).toBe("idle");
      expect(result.current.feeSats).toBeNull();
      expect(result.current.result).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isPreparing).toBe(false);
      expect(result.current.isSubmitting).toBe(false);
    });
  });
});
