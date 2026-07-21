import { useMemo, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type { AssetOption } from "../hooks/useAssets.js";
import { usePrices } from "../hooks/usePrices.js";
import type { WithdrawTarget } from "../hooks/useWithdraw.js";
import { assetKey, formatUsd, truncate } from "./format.js";
import {
  useWalletTokenSummary,
  type TokenSymbol,
  type WalletTokenSummary,
} from "./useWalletTokenSummary.js";

/** The per-balance action affordances. */
export type ActionKind = "deposit" | "withdraw" | "sell";

/** Deposit picks the address a given asset is (or would be) received on. */
export type DepositType = AssetOption["type"] | "btc";

export const ACTION_LABEL: Record<ActionKind, string> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  sell: "Sell",
};

export interface DepositInfo {
  /** Human-readable name of what's being received (e.g. "BTC", "XCP", "NFT"). */
  symbol: string;
  /** The address type + value to display. */
  label: string;
  address: string;
}

/** One "other holdings" tab: a group of non-headline assets of a single kind. */
export interface OtherGroup {
  label: string;
  depositType: DepositType;
  depositSymbol: string;
  options: AssetOption[];
}

/**
 * The address to receive an asset on: Kontor assets (KOR token + Kontor NFTs)
 * and ordinals land on Taproot, everything else (BTC, Counterparty tokens) on
 * Segwit.
 */
export function depositTargetFor(
  type: DepositType,
  addresses: { p2wpkh: string; p2tr?: string },
): { label: string; address: string } {
  if (type === "ordinal" || type === "kontor-nft" || type === "kor") {
    return {
      label: "Taproot (P2TR)",
      address: addresses.p2tr ?? addresses.p2wpkh,
    };
  }
  return { label: "Segwit (P2WPKH)", address: addresses.p2wpkh };
}

/** Short display name for an "other" holding, used in the deposit modal. */
export function assetDepositLabel(a: AssetOption): string {
  switch (a.type) {
    case "counterparty":
      return a.assetLongname ?? a.assetName;
    case "zeld":
      return "ZELD";
    case "kor":
      return "KOR";
    case "kontor-nft":
      return "NFT";
    case "ordinal":
      return "Inscription";
  }
}

/** Name + optional sub-line (balance / id) for an "other" holding tile. */
export function otherLabel(a: AssetOption): { name: string; sub: string | null } {
  switch (a.type) {
    case "counterparty":
      return { name: a.assetLongname ?? a.assetName, sub: a.quantityNormalized };
    case "kontor-nft":
      return { name: `NFT ${truncate(a.nftId)}`, sub: null };
    case "ordinal":
      return { name: "Inscription", sub: truncate(a.inscriptionId) };
    default:
      return { name: "", sub: null };
  }
}

/** Modal heading suffix for a withdraw target. */
export function withdrawTitle(target: WithdrawTarget): string {
  switch (target.type) {
    case "btc":
      return "BTC";
    case "counterparty":
      return target.assetLongname ?? target.assetName;
    case "zeld":
      return "ZELD";
    case "kor":
      return "KOR";
    case "ordinal":
      return "Ordinal";
    case "kontor-nft":
      return "NFT";
  }
}

/** Stable remount key for a withdraw target. */
export function withdrawKey(target: WithdrawTarget): string {
  return target.type === "btc" ? "btc" : assetKey(target);
}

/** The deposit type of a headline token (XCP/KOR/ZELD). */
export function tokenDepositType(symbol: TokenSymbol): DepositType {
  return symbol === "XCP" ? "counterparty" : symbol === "KOR" ? "kor" : "zeld";
}

export interface UseWalletBalancesControllerResult extends WalletTokenSummary {
  /** USD value of the BTC balance, or null without a price. */
  usd: string | null;
  /** Wallet addresses (Segwit / Taproot), or null when disconnected. */
  addresses: { p2wpkh: string; p2tr?: string } | null;
  /** The non-headline holdings grouped into the Counterparty/Kontor/Ordinals tabs. */
  otherGroups: OtherGroup[];
  /** The currently active "other holdings" tab (user choice, else first non-empty). */
  activeGroup: OtherGroup;
  activeLabel: string;
  setOtherTab: (label: string) => void;
  // Modal targets + setters.
  deposit: DepositInfo | null;
  closeDeposit: () => void;
  sellAsset: AssetOption | null;
  setSellAsset: (asset: AssetOption | null) => void;
  withdraw: WithdrawTarget | null;
  setWithdraw: (target: WithdrawTarget | null) => void;
  /** True when the BTC balance is loaded and non-zero (withdraw is possible). */
  canWithdrawBtc: boolean;
  /** Open the BTC withdraw modal (no-op unless {@link canWithdrawBtc}). */
  openBtcWithdraw: () => void;
  /** Open the deposit modal for a named symbol + deposit type. */
  openDeposit: (symbol: string, type: DepositType) => void;
  /** Open the deposit modal for a specific owned asset. */
  openDepositForAsset: (asset: AssetOption) => void;
}

/**
 * Platform-neutral controller for the `WalletBalances` renderers. Owns the
 * deposit/sell/withdraw modal state, the Counterparty/Kontor/Ordinals tab
 * grouping + active-tab fallback, the deposit-address resolution, and the USD
 * derivation — so the web and native components share one behavior and differ
 * only in markup.
 */
export function useWalletBalancesController(): UseWalletBalancesControllerResult {
  const summary = useWalletTokenSummary();
  const { btcSats, others } = summary;
  const { btcUsd } = usePrices();
  const { addresses } = useHorizonMarket();

  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [sellAsset, setSellAsset] = useState<AssetOption | null>(null);
  const [withdraw, setWithdraw] = useState<WithdrawTarget | null>(null);
  const [otherTab, setOtherTab] = useState<string | null>(null);

  const openDeposit = (symbol: string, type: DepositType) => {
    if (!addresses) return;
    const target = depositTargetFor(type, addresses);
    setDeposit({ symbol, label: target.label, address: target.address });
  };
  const openDepositForAsset = (asset: AssetOption) =>
    openDeposit(assetDepositLabel(asset), asset.type);

  const otherGroups = useMemo<OtherGroup[]>(
    () => [
      {
        label: "Counterparty",
        depositType: "counterparty",
        depositSymbol: "Counterparty assets",
        options: others.filter((a) => a.type === "counterparty"),
      },
      {
        label: "Kontor",
        depositType: "kontor-nft",
        depositSymbol: "Kontor NFTs",
        options: others.filter((a) => a.type === "kontor-nft"),
      },
      {
        label: "Ordinals",
        depositType: "ordinal",
        depositSymbol: "Ordinals",
        options: others.filter((a) => a.type === "ordinal"),
      },
    ],
    [others],
  );

  // Active other-holdings tab: user choice, else the first group that has any
  // holdings, else the first tab.
  const activeLabel =
    otherTab ??
    otherGroups.find((g) => g.options.length > 0)?.label ??
    otherGroups[0].label;
  const activeGroup =
    otherGroups.find((g) => g.label === activeLabel) ?? otherGroups[0];

  const usd = btcSats === null ? null : formatUsd(Number(btcSats), btcUsd);

  // Single source of truth for the BTC withdraw affordance, shared by both
  // renderers so the enable rule + target can't drift between platforms.
  const canWithdrawBtc = btcSats !== null && btcSats !== 0n;
  const openBtcWithdraw = () => {
    if (btcSats === null || btcSats === 0n) return;
    setWithdraw({ type: "btc", balanceSats: btcSats });
  };

  return {
    ...summary,
    usd,
    addresses,
    otherGroups,
    activeGroup,
    activeLabel,
    setOtherTab,
    deposit,
    closeDeposit: () => setDeposit(null),
    sellAsset,
    setSellAsset,
    withdraw,
    setWithdraw,
    canWithdrawBtc,
    openBtcWithdraw,
    openDeposit,
    openDepositForAsset,
  };
}
