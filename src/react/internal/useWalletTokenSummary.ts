import { useMemo } from "react";
import { useHorizonMarket } from "../context.js";
import {
  useAssets,
  type AssetOption,
  type UseAssetsResult,
} from "../hooks/useAssets.js";
import { useBtcBalance } from "../hooks/useBtcBalance.js";
import { formatAmount } from "./format.js";
import { useProtocolVisibility } from "./useProtocolVisibility.js";

/**
 * The headline balances, in display order. BTC and XCP always show; KOR and
 * ZELD only where their protocol is configured (see `useProtocolVisibility`) —
 * a network the protocol doesn't run on gets no row at all, not a dead "0".
 */
export type TokenSymbol = "BTC" | "XCP" | "KOR" | "ZELD";

export interface TokenLine {
  symbol: TokenSymbol;
  /**
   * Human-readable amount (e.g. "0", "1.5"), or null when it isn't known yet
   * (still loading) or at all ({@link TokenLine.error} set). A failed read must
   * NOT fall back to "0" — the source of this line yields no holdings either
   * way, and "0" is a confident claim about a balance we could not read.
   */
  amount: string | null;
  /**
   * The failure that makes `amount` null, or null when the read succeeded. Same
   * per-source errors as `OtherGroup.error`, mapped to the token this line
   * shows: XCP ← counterparty, ZELD ← zeld, KOR ← kontor, BTC ← the BTC read.
   */
  error: Error | null;
  /**
   * Synthetic owned-asset used to render the brand avatar (XCP/KOR/ZELD). Null
   * for BTC, which uses the dedicated Bitcoin mark instead.
   */
  asset: AssetOption | null;
  /**
   * The real owned option to pre-select when selling this token (with its true
   * holding address + balance), or null when the wallet holds none / it isn't
   * sellable (BTC). When several are held, the largest balance wins.
   */
  sellAsset: AssetOption | null;
}

/**
 * What a renderer should print for a token amount: the value, `…` while it
 * loads, `—` when the read failed. Shared by all four render sites (web +
 * native × full list + dropdown summary) so a failure can't read as a zero on
 * one platform and as a dash on the other.
 */
export function tokenAmountText(line: TokenLine): string {
  if (line.error) return "—";
  return line.amount ?? "…";
}

/** Tooltip / accessibility label for a token amount, naming the failure. */
export function tokenAmountTitle(line: TokenLine): string {
  return line.error
    ? `Couldn't load your ${line.symbol} balance: ${line.error.message}`
    : `${tokenAmountText(line)} ${line.symbol}`;
}

export interface WalletTokenSummary {
  /** BTC headline line (asset === null → rendered with the Bitcoin mark). */
  btc: TokenLine;
  /** Raw BTC balance in sats (for USD conversion), or null while loading. */
  btcSats: bigint | null;
  /**
   * XCP, plus KOR / ZELD where their protocol is configured — "0" when the
   * wallet holds none and a null `amount` + set `error` when that token's
   * source could not be read. A protocol this app isn't configured for
   * contributes NO line (see {@link TokenSymbol}).
   */
  primary: TokenLine[];
  /** BTC + {@link WalletTokenSummary.primary} in display order (compact grid). */
  tokens: TokenLine[];
  /** Every other holding: non-XCP Counterparty assets, Kontor NFTs, ordinals. */
  others: AssetOption[];
  /**
   * Per-source fetch failures, passed straight through from `useAssets`. A
   * rejected source yields NO holdings rather than an error, so a renderer that
   * ignores this shows an empty list that is indistinguishable from "you own
   * nothing" — see `OtherGroup.state`.
   */
  errors: UseAssetsResult["errors"];
  /**
   * Per-source read state, passed straight through from `useAssets` — the
   * superset of `errors` that also distinguishes "still loading" and "this app
   * never reads that source" from a genuinely empty group.
   */
  sources: UseAssetsResult["sources"];
  /** True until BTC and the owned-asset groups have first resolved. */
  loading: boolean;
  /** True while a balance refresh (BTC or assets) is in flight. */
  isFetching: boolean;
  /** Epoch ms of the last owned-assets fetch, or null. */
  lastFetchedAt: number | null;
  /** Re-fetch BTC + owned balances, bypassing caches. */
  refresh: () => void;
}

type CounterpartyOption = Extract<AssetOption, { type: "counterparty" }>;
type ZeldOption = Extract<AssetOption, { type: "zeld" }>;
type KorOption = Extract<AssetOption, { type: "kor" }>;

const isXcp = (a: AssetOption): a is CounterpartyOption =>
  a.type === "counterparty" && a.assetName === "XCP";

/** Sum the base-unit balances of a fungible-option list (bigint). */
function sumBalance(options: { balance: bigint }[]): bigint {
  return options.reduce((total, o) => total + o.balance, 0n);
}

/** The largest-balance option of a fungible list (for the sell pre-selection). */
function largestBalance<T extends { balance: bigint }>(options: T[]): T | null {
  return options.reduce<T | null>(
    (best, o) => (best === null || o.balance > best.balance ? o : best),
    null,
  );
}

/**
 * Aggregates the connected wallet's balances into the headline tokens (BTC and
 * XCP always; KOR / ZELD where their protocol is configured) plus every other
 * holding — sharing one fetch between the wallet dropdown summary and the full
 * wallet page.
 *
 * Platform-neutral (no DOM): consumed by both the web and native renderers of
 * `WalletBalances` / `WalletBalanceSummary`.
 */
export function useWalletTokenSummary(): WalletTokenSummary {
  const { addresses } = useHorizonMarket();
  const assets = useAssets();
  const btc = useBtcBalance();
  const protocols = useProtocolVisibility();

  const address = addresses?.p2wpkh ?? "";

  return useMemo<WalletTokenSummary>(() => {
    const xcpOptions = assets.counterpartyAssets.filter(isXcp);
    const xcpAmount = xcpOptions.length
      ? formatAmount(sumBalance(xcpOptions), xcpOptions[0].divisible)
      : "0";
    const zeldOptions = assets.zeldAssets.filter(
      (a): a is ZeldOption => a.type === "zeld",
    );
    const zeldAmount = zeldOptions.length
      ? formatAmount(sumBalance(zeldOptions), true)
      : "0";
    const korOption = assets.korAssets.find(
      (a): a is KorOption => a.type === "kor",
    );
    const korAmount = korOption?.amount ?? "0";

    // A source that failed contributed NO options, so its computed amount is a
    // "0" that means "we couldn't look", not "you hold none" — blank it and hand
    // the renderers the reason instead. Same rule as the other-holdings tabs.
    const { counterparty: cpError, zeld: zeldError, kontor: korError } =
      assets.errors;

    const btcLine: TokenLine = {
      symbol: "BTC",
      amount: btc.sats === null ? null : formatAmount(btc.sats, true),
      error: btc.error,
      asset: null,
      sellAsset: null,
    };

    // Synthetic 0-balance options so the brand avatars (and monogram fallbacks)
    // render identically to the sell-order asset picker, even at a zero balance.
    // `sellAsset` is instead the *real* held option (true address + balance), so
    // launching a sell from the balance pre-selects a listable asset.
    const xcpLine: TokenLine = {
      symbol: "XCP",
      amount: cpError ? null : xcpAmount,
      error: cpError,
      asset: {
        type: "counterparty",
        assetName: "XCP",
        address,
        balance: 0n,
        quantityNormalized: xcpAmount,
        divisible: true,
      },
      sellAsset: largestBalance(xcpOptions),
    };
    const korLine: TokenLine = {
      symbol: "KOR",
      amount: korError ? null : korAmount,
      error: korError,
      asset: { type: "kor", address, amount: korAmount },
      sellAsset: korOption ?? null,
    };
    const zeldLine: TokenLine = {
      symbol: "ZELD",
      amount: zeldError ? null : zeldAmount,
      error: zeldError,
      asset: {
        type: "zeld",
        address,
        balance: 0n,
        quantityNormalized: zeldAmount,
        divisible: true,
      },
      sellAsset: largestBalance(zeldOptions),
    };

    // A protocol this app isn't configured for gets no row at all — a "0" (or
    // even a dash) for a token that can't exist on this network reads as a
    // balance, and the row would invite deposits nothing can read back.
    const primary = [
      xcpLine,
      ...(protocols.kontor ? [korLine] : []),
      ...(protocols.zeld ? [zeldLine] : []),
    ];
    const others: AssetOption[] = [
      ...assets.counterpartyAssets.filter((a) => !isXcp(a)),
      ...assets.kontorNfts,
      ...assets.ordinals,
    ];

    return {
      btc: btcLine,
      btcSats: btc.sats,
      primary,
      tokens: [btcLine, ...primary],
      others,
      errors: assets.errors,
      sources: assets.sources,
      loading: btc.loading || (!assets.lastFetchedAt && assets.isFetching),
      isFetching: assets.isFetching || btc.loading,
      lastFetchedAt: assets.lastFetchedAt,
      refresh: () => {
        assets.refresh();
        btc.refresh();
      },
    };
  }, [assets, btc, address, protocols]);
}
