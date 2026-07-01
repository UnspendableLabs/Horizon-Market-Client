import { useMemo } from "react";
import { useHorizonMarket } from "../context.js";
import { useAssets, type AssetOption } from "../hooks/useAssets.js";
import { useBtcBalance } from "../hooks/useBtcBalance.js";
import { assetImageUrl, formatAmount } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.web.js";

/** The four headline balances every wallet always shows, in display order. */
export type TokenSymbol = "BTC" | "XCP" | "KOR" | "ZELD";

export interface TokenLine {
  symbol: TokenSymbol;
  /** Human-readable amount (e.g. "0", "1.5"), or null while BTC is loading. */
  amount: string | null;
  /**
   * Synthetic owned-asset used to render the brand avatar (XCP/KOR/ZELD). Null
   * for BTC, which uses the dedicated {@link BtcGoldIcon} mark instead.
   */
  asset: AssetOption | null;
  /**
   * The real owned option to pre-select when selling this token (with its true
   * holding address + balance), or null when the wallet holds none / it isn't
   * sellable (BTC). When several are held, the largest balance wins.
   */
  sellAsset: AssetOption | null;
}

export interface WalletTokenSummary {
  /** BTC headline line (asset === null → rendered with the Bitcoin mark). */
  btc: TokenLine;
  /** Raw BTC balance in sats (for USD conversion), or null while loading. */
  btcSats: bigint | null;
  /** XCP, KOR, ZELD — always present, "0" when the wallet holds none. */
  primary: TokenLine[];
  /** BTC + XCP + KOR + ZELD in display order (for the compact grid). */
  tokens: TokenLine[];
  /** Every other holding: non-XCP Counterparty assets, Kontor NFTs, ordinals. */
  others: AssetOption[];
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
 * Aggregates the connected wallet's balances into the four headline tokens
 * (BTC/XCP/KOR/ZELD, always shown) plus every other holding — sharing one fetch
 * between the wallet dropdown summary and the full wallet page.
 */
export function useWalletTokenSummary(): WalletTokenSummary {
  const { addresses } = useHorizonMarket();
  const assets = useAssets();
  const btc = useBtcBalance();

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

    const btcLine: TokenLine = {
      symbol: "BTC",
      amount: btc.sats === null ? null : formatAmount(btc.sats, true),
      asset: null,
      sellAsset: null,
    };

    // Synthetic 0-balance options so the brand avatars (and monogram fallbacks)
    // render identically to the sell-order asset picker, even at a zero balance.
    // `sellAsset` is instead the *real* held option (true address + balance), so
    // launching a sell from the balance pre-selects a listable asset.
    const xcpLine: TokenLine = {
      symbol: "XCP",
      amount: xcpAmount,
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
      amount: korAmount,
      asset: { type: "kor", address, amount: korAmount },
      sellAsset: korOption ?? null,
    };
    const zeldLine: TokenLine = {
      symbol: "ZELD",
      amount: zeldAmount,
      asset: {
        type: "zeld",
        address,
        balance: 0n,
        quantityNormalized: zeldAmount,
        divisible: true,
      },
      sellAsset: largestBalance(zeldOptions),
    };

    const primary = [xcpLine, korLine, zeldLine];
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
      loading: btc.loading || (!assets.lastFetchedAt && assets.isFetching),
      isFetching: assets.isFetching || btc.loading,
      lastFetchedAt: assets.lastFetchedAt,
      refresh: () => {
        assets.refresh();
        btc.refresh();
      },
    };
  }, [assets, btc, address]);
}

/** Round brand mark for a headline token: Bitcoin gold for BTC, avatar else. */
export function TokenMark({
  line,
  size,
}: {
  line: TokenLine;
  size: number;
}) {
  const { baseUrl } = useHorizonMarket();
  if (!line.asset) return <BtcGoldIcon size={size} />;
  return (
    <AssetAvatar
      asset={line.asset}
      size={size}
      radius={size / 2}
      imageUrl={assetImageUrl(baseUrl, line.asset)}
    />
  );
}
