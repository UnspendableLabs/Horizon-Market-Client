import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import {
  assetImageUrl,
  assetKey,
  cx,
  formatRelativeTime,
  truncate,
} from "../internal/format.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";
import { NoImageIcon } from "../internal/icons.web.js";
import {
  TokenMark,
  type TokenLine,
} from "../internal/walletBalances.web.js";
import {
  ACTION_LABEL,
  otherLabel,
  tokenDepositType,
  useWalletBalancesController,
  withdrawKey,
  withdrawTitle,
  type ActionKind,
  type DepositType,
} from "../internal/useWalletBalancesController.js";
import { Modal } from "./Modal.web.js";
import { SellOrderForm } from "./SellOrderForm.web.js";
import { WithdrawForm } from "./WithdrawForm.web.js";

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
  /** Optional heading rendered at the left of the header row (title lives on the
   * same line as the "Updated …" timestamp + Refresh button). */
  title?: ReactNode;
  /**
   * Override the per-asset "Sell" action. When provided, clicking Sell calls this
   * instead of opening the built-in sell modal — e.g. to navigate to a dedicated
   * Sell screen with the asset pre-selected. When omitted, the internal modal
   * (an inline {@link SellOrderForm}) is used.
   */
  onSellAsset?: (asset: AssetOption) => void;
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
  gap: webTokens.spacingMd,
  flexWrap: "wrap",
};

// "Updated … · Refresh", pinned to the right of the header row.
const headerMeta: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  marginLeft: "auto",
};

const refreshButton: CSSProperties = {
  ...ws.secondaryButton,
  padding: "4px 10px",
  fontSize: 12,
};

// A titled section (title + content) — the title carries equal space above and
// below (matching the page's inter-block rhythm).
const section: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

// Section subtitle ("Addresses", "Balances") — a bit more prominent than the
// per-group header.
const sectionTitle: CSSProperties = {
  fontSize: webTokens.fontSizeLg,
  fontWeight: 700,
  color: webTokens.text,
};

// Addresses block: one row per receiving address (label · value · copy).
const addressList: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingMd,
};

const addressRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  padding: "16px 20px",
  background: webTokens.surface,
  borderRadius: webTokens.radiusMd,
};

const addressRowLabel: CSSProperties = {
  flexShrink: 0,
  width: 108,
  fontSize: webTokens.fontSizeBase,
  fontWeight: 600,
  color: webTokens.textMuted,
};

const addressRowValue: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "monospace",
  fontSize: webTokens.fontSizeBase,
  color: webTokens.text,
};

// Underline "tab" row for the other-holdings groups (swap-list style): only the
// active tab carries an underline (no full-width baseline).
const tabRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: webTokens.spacingLg,
  flexWrap: "wrap",
};

// Empty tab: hint + a Deposit button pointing at the group's receiving address.
const emptyOthers: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  flexWrap: "wrap",
};

// BTC headline — the largest, top-of-page balance, on a subtly lighter rounded
// card, with its action buttons pinned to the right. `flexWrap` lets the buttons
// drop below the (large) balance on narrow phones instead of colliding with it;
// the action row's `marginLeft:auto` keeps them bottom-right once wrapped.
const btcCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
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

// XCP / KOR / ZELD headline tokens: three cells across on desktop, collapsing
// responsively to fewer columns — down to one per line on phones — so the
// balance + action buttons never overlap in a cramped cell. `min(100%, 220px)`
// keeps a single cell from overflowing a container narrower than 220px.
const tokenGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
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

// "Other holdings" grid — each holding is a padded card: media on top, the full
// asset name on its own line, then the balance + compact actions on one line.
const othersGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 52,
  marginTop: webTokens.spacingSm,
};

const tile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  minWidth: 0,
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
  padding: 28,
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

/** One receiving address: label · truncated value · copy-to-clipboard button. */
function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div style={addressRow}>
      <span style={addressRowLabel}>{label}</span>
      <span style={addressRowValue} title={address}>
        {truncate(address, 12, 8)}
      </span>
      <CopyButton value={address} />
    </div>
  );
}

/** Mountain + sun "no image" pictogram (matches the swap list's placeholder). */
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
  onWithdraw: (asset: AssetOption) => void;
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
          <IconAction kind="withdraw" onClick={() => onWithdraw(asset)} />
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
  title,
  onSellAsset,
  className,
  classNames,
  style,
}: WalletBalancesProps) {
  const {
    btc,
    primary,
    isFetching,
    lastFetchedAt,
    refresh,
    usd,
    addresses,
    otherGroups,
    activeGroup,
    activeLabel,
    setOtherTab,
    deposit,
    closeDeposit,
    sellAsset,
    setSellAsset,
    withdraw,
    setWithdraw,
    canWithdrawBtc,
    openBtcWithdraw,
    openDeposit,
    openDepositForAsset,
  } = useWalletBalancesController();

  return (
    <div
      className={cx(classNames?.root, className)}
      style={{ ...root, ...style }}
    >
      <div className={classNames?.header} style={headerRow}>
        {title}
        <div style={headerMeta}>
          <span style={ws.mutedText}>
            Updated {formatRelativeTime(lastFetchedAt)}
          </span>
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
      </div>

      {addresses && (
        <div style={section}>
          <div style={sectionTitle}>Addresses</div>
          <div style={addressList}>
            <AddressRow label="Segwit (P2WPKH)" address={addresses.p2wpkh} />
            {addresses.p2tr && (
              <AddressRow label="Taproot (P2TR)" address={addresses.p2tr} />
            )}
          </div>
        </div>
      )}

      <div style={sectionTitle}>Balances</div>

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
        <div style={{ ...actionRow, marginLeft: "auto" }}>
          <LabeledAction
            kind="deposit"
            onClick={() => openDeposit("BTC", "btc")}
          />
          <LabeledAction
            kind="withdraw"
            disabled={!canWithdrawBtc}
            title={canWithdrawBtc ? "Withdraw" : "No BTC to withdraw"}
            onClick={openBtcWithdraw}
          />
        </div>
      </div>

      <div style={tokenGrid}>
        {primary.map((line) => (
          <TokenCell
            key={line.symbol}
            line={line}
            className={classNames?.token}
            onDeposit={openDeposit}
            onWithdraw={setWithdraw}
            onSell={onSellAsset ?? setSellAsset}
          />
        ))}
      </div>

      <div style={section}>
        <div className={classNames?.groupHeader} style={tabRow}>
          {otherGroups.map((group) => (
            <button
              key={group.label}
              type="button"
              onClick={() => setOtherTab(group.label)}
              style={ws.metaTab(group.label === activeLabel)}
            >
              {group.label}
            </button>
          ))}
        </div>
        {activeGroup.options.length === 0 ? (
          <div style={emptyOthers}>
            <span style={ws.mutedText}>
              No {activeGroup.label} holdings yet.
            </span>
            <LabeledAction
              kind="deposit"
              onClick={() =>
                openDeposit(activeGroup.depositSymbol, activeGroup.depositType)
              }
            />
          </div>
        ) : (
          <div style={{ ...othersGrid, marginTop: 0 }}>
            {activeGroup.options.map((a) => (
              <OtherAssetTile
                key={assetKey(a)}
                asset={a}
                onDeposit={openDepositForAsset}
                onWithdraw={setWithdraw}
                onSell={onSellAsset ?? setSellAsset}
                className={classNames?.tile}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={deposit != null}
        onClose={closeDeposit}
        title={deposit ? `Deposit ${deposit.symbol}` : ""}
      >
        {deposit && (
          <div style={depositBody}>
            <p style={depositHint}>
              Send {deposit.symbol} from your exchange or preferred wallet to
              your {deposit.label} address below.
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

      <Modal
        open={withdraw != null}
        onClose={() => setWithdraw(null)}
        title={withdraw ? `Withdraw ${withdrawTitle(withdraw)}` : ""}
      >
        {withdraw && (
          <WithdrawForm
            key={withdrawKey(withdraw)}
            target={withdraw}
            onClose={() => setWithdraw(null)}
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
  onWithdraw: (asset: AssetOption) => void;
  onSell: (asset: AssetOption) => void;
}): ReactNode {
  const depositType = tokenDepositType(line.symbol);
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
        <IconAction
          kind="withdraw"
          disabled={!sellAsset}
          onClick={() => sellAsset && onWithdraw(sellAsset)}
        />
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
