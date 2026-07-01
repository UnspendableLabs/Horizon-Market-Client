import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { usePrices } from "../hooks/usePrices.js";
import { useHorizonMarket } from "../context.js";
import {
  assetImageUrl,
  assetKey,
  cx,
  formatRelativeTime,
  formatUsd,
  truncate,
} from "../internal/format.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
import {
  TokenMark,
  useWalletTokenSummary,
  type TokenLine,
} from "../internal/walletBalances.web.js";
import { Modal } from "./Modal.web.js";
import { SellOrderForm } from "./SellOrderForm.web.js";

export interface WalletBalancesClassNames {
  root?: string;
  header?: string;
  buttonSecondary?: string;
  btc?: string;
  token?: string;
  tile?: string;
  groupHeader?: string;
}

export interface WalletBalancesProps {
  className?: string;
  classNames?: WalletBalancesClassNames;
  style?: CSSProperties;
}

const root: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
};

const refreshButton: CSSProperties = {
  ...ws.secondaryButton,
  padding: "4px 10px",
  fontSize: 12,
};

// BTC headline — the largest, top-of-page balance, on a subtly lighter rounded
// card, with its action buttons pinned to the right.
const btcCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingMd,
  padding: "24px 28px",
  background: webTokens.surface,
  borderRadius: webTokens.radiusLg,
};

const balanceInfo: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  minWidth: 0,
};

const btcAmount: CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1.1,
  color: webTokens.text,
};

const btcUnit: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: webTokens.textMuted,
};

const btcUsdText: CSSProperties = {
  marginTop: 2,
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
};

// XCP / KOR / ZELD headline tokens sit together on one row (3 cells), balance on
// the left and the labeled action buttons pinned to the right of each cell.
const tokenGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 20,
};

const tokenCell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: webTokens.spacingSm,
  minWidth: 0,
  padding: "22px 24px",
  background: webTokens.surface,
  borderRadius: webTokens.radiusLg,
};

const tokenAmount: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1.15,
  fontVariantNumeric: "tabular-nums",
};

const tokenSymbol: CSSProperties = {
  marginTop: 2,
  fontSize: webTokens.fontSizeBase,
  color: webTokens.textMuted,
};

const groupHeader: CSSProperties = {
  marginTop: webTokens.spacingSm,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  color: webTokens.textMuted,
};

// "Other holdings" grid — each holding is a padded card: media on top, the full
// asset name on its own line, then the balance + compact actions on one line.
const othersGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 24,
  marginTop: webTokens.spacingSm,
};

const tile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  minWidth: 0,
  padding: webTokens.spacingMd,
  background: webTokens.surface,
  borderRadius: webTokens.radiusLg,
};

// Balance on the left, actions pushed to the right, all on one line.
const tileFooter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
};

const mediaBox: CSSProperties = {
  width: "100%",
  aspectRatio: "1",
  background: "rgba(0, 0, 0, 0.33)",
  borderRadius: webTokens.radiusMd,
  boxSizing: "border-box",
  display: "block",
};

const mediaImg: CSSProperties = {
  ...mediaBox,
  objectFit: "contain",
  padding: webTokens.spacingMd,
};

const mediaPlaceholder: CSSProperties = {
  ...mediaBox,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: webTokens.textMuted,
};

// The asset name gets its own line and is never truncated (wraps if long).
const tileName: CSSProperties = {
  display: "block",
  fontWeight: 600,
  overflowWrap: "anywhere",
};

// Balance shown in full white beside the actions.
const tileBalance: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: webTokens.fontSizeSm,
  color: webTokens.text,
  fontVariantNumeric: "tabular-nums",
};

// A horizontal row of labeled action buttons (icon + text), pinned to a
// balance card's right.
const actionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
};

const labeledAction: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: 28,
  padding: "0 10px",
  background: "transparent",
  color: webTokens.text,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  lineHeight: 1.2,
};

// A horizontal row of icon-only action buttons (label shown on hover), used on
// the compact "other holdings" tiles.
const iconRow: CSSProperties = {
  display: "flex",
  gap: 6,
  flexShrink: 0,
  marginLeft: "auto",
};

const iconAction: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  background: "transparent",
  color: webTokens.text,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusMd,
  cursor: "pointer",
  flexShrink: 0,
};

const depositBody: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingMd,
  color: webTokens.text,
  fontFamily: webTokens.fontFamily,
  fontSize: webTokens.fontSizeBase,
};

const depositHint: CSSProperties = {
  margin: 0,
  color: webTokens.textMuted,
  fontSize: webTokens.fontSizeSm,
  lineHeight: 1.5,
};

const addressBox: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  padding: webTokens.spacingSm,
  background: webTokens.background,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
};

const addressText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  wordBreak: "break-all",
  fontSize: webTokens.fontSizeSm,
  fontFamily: "monospace",
  color: webTokens.text,
};

const copyButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: 30,
  height: 30,
  padding: 0,
  background: "transparent",
  color: webTokens.textMuted,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  cursor: "pointer",
};

type ActionKind = "deposit" | "withdraw" | "sell";
/** Deposit picks the address a given asset is (or would be) received on. */
type DepositType = AssetOption["type"] | "btc";

const ACTION_LABEL: Record<ActionKind, string> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  sell: "Sell",
};

interface DepositInfo {
  /** Human-readable name of what's being received (e.g. "BTC", "XCP", "NFT"). */
  symbol: string;
  /** The address type + value to display. */
  label: string;
  address: string;
}

/** The address to receive an asset on: ordinals land on Taproot, else Segwit. */
function depositTargetFor(
  type: DepositType,
  addresses: { p2wpkh: string; p2tr?: string },
): { label: string; address: string } {
  if (type === "ordinal") {
    return {
      label: "Taproot (P2TR)",
      address: addresses.p2tr ?? addresses.p2wpkh,
    };
  }
  return { label: "Segwit (P2WPKH)", address: addresses.p2wpkh };
}

/** Short display name for an "other" holding, used in the deposit modal. */
function assetDepositLabel(a: AssetOption): string {
  switch (a.type) {
    case "counterparty":
      return a.assetName;
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

/* ── Icons (stroke-based, currentColor — no icon-lib dependency) ─────────── */

interface IconProps {
  size?: number;
}

function iconSvgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    style: { display: "block" as const },
  };
}

/** Arrow down onto a baseline — "receive / deposit". */
function DepositIcon({ size = 16 }: IconProps) {
  return (
    <svg {...iconSvgProps(size)}>
      <path d="M12 3v11" />
      <path d="m7 9 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

/** Arrow up off a baseline — "send / withdraw". */
function WithdrawIcon({ size = 16 }: IconProps) {
  return (
    <svg {...iconSvgProps(size)}>
      <path d="M12 21V10" />
      <path d="m7 15 5-5 5 5" />
      <path d="M5 3h14" />
    </svg>
  );
}

/** Price tag — "sell / list". */
function SellIcon({ size = 16 }: IconProps) {
  return (
    <svg {...iconSvgProps(size)}>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="1.25" />
    </svg>
  );
}

function CopyIcon({ size = 14 }: IconProps) {
  return (
    <svg {...iconSvgProps(size)}>
      <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg {...iconSvgProps(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ActionGlyph({ kind, size }: { kind: ActionKind; size: number }) {
  if (kind === "deposit") return <DepositIcon size={size} />;
  if (kind === "withdraw") return <WithdrawIcon size={size} />;
  return <SellIcon size={size} />;
}

/** Full-width labeled action button (icon + text) for a headline balance row. */
function LabeledAction({
  kind,
  disabled,
  title,
  onClick,
}: {
  kind: ActionKind;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={ws.withDisabled(labeledAction, Boolean(disabled))}
    >
      <ActionGlyph kind={kind} size={14} />
      <span>{ACTION_LABEL[kind]}</span>
    </button>
  );
}

/** Icon-only action button (label shown on hover) for the compact tiles. */
function IconAction({
  kind,
  disabled,
  onClick,
}: {
  kind: ActionKind;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={ACTION_LABEL[kind]}
      aria-label={ACTION_LABEL[kind]}
      style={ws.withDisabled(iconAction, Boolean(disabled))}
    >
      <ActionGlyph kind={kind} size={16} />
    </button>
  );
}

/** Copies an address to the clipboard, flashing a check for 1.5s. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy address"}
      aria-label={copied ? "Copied" : "Copy address"}
      style={copyButton}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

/** Mountain + sun "no image" pictogram (matches the swap list's placeholder). */
function NoImageIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/** Name + optional sub-line (balance / id) for an "other" holding. */
function otherLabel(a: AssetOption): { name: string; sub: string | null } {
  switch (a.type) {
    case "counterparty":
      return { name: a.assetName, sub: a.quantityNormalized };
    case "kontor-nft":
      return { name: `NFT ${truncate(a.nftId)}`, sub: null };
    case "ordinal":
      return { name: "Inscription", sub: truncate(a.inscriptionId) };
    default:
      return { name: "", sub: null };
  }
}

/** Square artwork panel with a placeholder fallback (swap-list style). */
function AssetMedia({ asset }: { asset: AssetOption }) {
  const { baseUrl } = useHorizonMarket();
  const [errored, setErrored] = useState(false);
  const url = assetImageUrl(baseUrl, asset, "image");
  if (url && !errored) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        style={mediaImg}
      />
    );
  }
  return (
    <div style={mediaPlaceholder}>
      <NoImageIcon size={28} />
    </div>
  );
}

/** A single "other holding" tile: media on top, name + compact actions below. */
function OtherAssetTile({
  asset,
  onDeposit,
  onWithdraw,
  onSell,
  className,
}: {
  asset: AssetOption;
  onDeposit: (asset: AssetOption) => void;
  onWithdraw: () => void;
  onSell: (asset: AssetOption) => void;
  className?: string;
}) {
  const { name, sub } = otherLabel(asset);
  return (
    <div className={className} style={tile}>
      <AssetMedia asset={asset} />
      <span style={tileName}>{name}</span>
      <div style={tileFooter}>
        {sub && (
          <span style={tileBalance} title={sub}>
            {sub}
          </span>
        )}
        <div style={iconRow}>
          <IconAction kind="deposit" onClick={() => onDeposit(asset)} />
          <IconAction kind="withdraw" onClick={onWithdraw} />
          <IconAction kind="sell" onClick={() => onSell(asset)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Full wallet balances list with per-balance actions.
 *
 * BTC is shown large at the top (Deposit / Withdraw); the XCP / KOR / ZELD
 * headline tokens each get a row with Deposit / Withdraw / Sell; and every other
 * holding is a swap-list-style tile carrying compact icon actions, grouped by
 * kind (Counterparty · Kontor · Ordinals). "Deposit" opens a modal with the
 * receiving address (Taproot for ordinals, Segwit otherwise); "Sell" opens the
 * sell-order flow with the asset pre-selected; "Withdraw" is a placeholder.
 */
export function WalletBalances({
  className,
  classNames,
  style,
}: WalletBalancesProps) {
  const { btc, btcSats, primary, others, isFetching, lastFetchedAt, refresh } =
    useWalletTokenSummary();
  const { btcUsd } = usePrices();
  const { addresses } = useHorizonMarket();

  const [deposit, setDeposit] = useState<DepositInfo | null>(null);
  const [sellAsset, setSellAsset] = useState<AssetOption | null>(null);

  const openDeposit = (symbol: string, type: DepositType) => {
    if (!addresses) return;
    const target = depositTargetFor(type, addresses);
    setDeposit({ symbol, label: target.label, address: target.address });
  };
  const openDepositForAsset = (asset: AssetOption) =>
    openDeposit(assetDepositLabel(asset), asset.type);
  // Withdraw is intentionally inert for now (feature not yet built).
  const handleWithdraw = () => {};

  const otherGroups = useMemo(
    () => [
      {
        label: "Counterparty",
        options: others.filter((a) => a.type === "counterparty"),
      },
      { label: "Kontor", options: others.filter((a) => a.type === "kontor-nft") },
      { label: "Ordinals", options: others.filter((a) => a.type === "ordinal") },
    ],
    [others],
  );

  const usd = btcSats === null ? null : formatUsd(Number(btcSats), btcUsd);

  return (
    <div className={cx(classNames?.root, className)} style={{ ...root, ...style }}>
      <div className={classNames?.header} style={headerRow}>
        <span style={ws.mutedText}>Updated {formatRelativeTime(lastFetchedAt)}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          className={classNames?.buttonSecondary}
          style={ws.withDisabled(refreshButton, isFetching)}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className={classNames?.btc} style={btcCard}>
        <div style={balanceInfo}>
          <TokenMark line={btc} size={44} />
          <div style={{ minWidth: 0 }}>
            <div>
              <span style={btcAmount}>{btc.amount ?? "…"}</span>{" "}
              <span style={btcUnit}>BTC</span>
            </div>
            {usd && <div style={btcUsdText}>{usd}</div>}
          </div>
        </div>
        <div style={actionRow}>
          <LabeledAction kind="deposit" onClick={() => openDeposit("BTC", "btc")} />
          <LabeledAction kind="withdraw" onClick={handleWithdraw} />
        </div>
      </div>

      <div style={tokenGrid}>
        {primary.map((line) => (
          <TokenCell
            key={line.symbol}
            line={line}
            className={classNames?.token}
            onDeposit={openDeposit}
            onWithdraw={handleWithdraw}
            onSell={setSellAsset}
          />
        ))}
      </div>

      {otherGroups.map((group) =>
        group.options.length === 0 ? null : (
          <div key={group.label}>
            <div className={classNames?.groupHeader} style={groupHeader}>
              {group.label}
            </div>
            <div style={othersGrid}>
              {group.options.map((a) => (
                <OtherAssetTile
                  key={assetKey(a)}
                  asset={a}
                  onDeposit={openDepositForAsset}
                  onWithdraw={handleWithdraw}
                  onSell={setSellAsset}
                  className={classNames?.tile}
                />
              ))}
            </div>
          </div>
        ),
      )}

      <Modal
        open={deposit != null}
        onClose={() => setDeposit(null)}
        title={deposit ? `Deposit ${deposit.symbol}` : ""}
      >
        {deposit && (
          <div style={depositBody}>
            <p style={depositHint}>
              Send {deposit.symbol} from your exchange or preferred wallet to your{" "}
              {deposit.label} address below.
            </p>
            <div style={ws.label}>
              <span>{deposit.label}</span>
              <div style={addressBox}>
                <span style={addressText}>{deposit.address}</span>
                <CopyButton value={deposit.address} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={sellAsset != null}
        onClose={() => setSellAsset(null)}
        title="Sell"
      >
        {sellAsset && (
          <SellOrderForm
            key={assetKey(sellAsset)}
            initialAsset={sellAsset}
            onClose={() => setSellAsset(null)}
          />
        )}
      </Modal>
    </div>
  );
}

/** XCP / KOR / ZELD headline cell: brand mark + amount + Deposit/Withdraw/Sell. */
function TokenCell({
  line,
  className,
  onDeposit,
  onWithdraw,
  onSell,
}: {
  line: TokenLine;
  className?: string;
  onDeposit: (symbol: string, type: DepositType) => void;
  onWithdraw: () => void;
  onSell: (asset: AssetOption) => void;
}): ReactNode {
  const depositType: DepositType =
    line.symbol === "XCP"
      ? "counterparty"
      : line.symbol === "KOR"
        ? "kor"
        : "zeld";
  const sellAsset = line.sellAsset;
  return (
    <div className={className} style={tokenCell}>
      <div style={balanceInfo} title={`${line.amount ?? "…"} ${line.symbol}`}>
        <TokenMark line={line} size={38} />
        <div style={{ minWidth: 0 }}>
          <div style={tokenAmount}>{line.amount ?? "…"}</div>
          <div style={tokenSymbol}>{line.symbol}</div>
        </div>
      </div>
      <div style={actionRow}>
        <IconAction
          kind="deposit"
          onClick={() => onDeposit(line.symbol, depositType)}
        />
        <IconAction kind="withdraw" onClick={onWithdraw} />
        <LabeledAction
          kind="sell"
          disabled={!sellAsset}
          title={sellAsset ? "Sell" : `No ${line.symbol} to sell`}
          onClick={() => sellAsset && onSell(sellAsset)}
        />
      </div>
    </div>
  );
}
