import type { CSSProperties } from "react";
import { cx } from "../internal/format.js";
import { webTokens } from "../theme.js";
import {
  TokenMark,
  useWalletTokenSummary,
  type TokenLine,
} from "../internal/walletBalances.web.js";

export interface WalletBalanceSummaryClassNames {
  root?: string;
  header?: string;
  grid?: string;
  cell?: string;
  showAll?: string;
}

export interface WalletBalanceSummaryProps {
  /** Invoked by the "Show all" button — e.g. navigate to the wallet page. */
  onShowAll?: () => void;
  /** Label for the "show all" affordance. */
  showAllLabel?: string;
  className?: string;
  classNames?: WalletBalanceSummaryClassNames;
  style?: CSSProperties;
}

const root: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: webTokens.spacingSm,
  fontFamily: webTokens.fontFamily,
};

const header: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: webTokens.textMuted,
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: webTokens.spacingSm,
};

const cell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  minWidth: 0,
  padding: `6px ${webTokens.spacingSm}`,
};

const amountText: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: webTokens.fontSizeBase,
  fontWeight: 600,
  color: webTokens.text,
};

const unitText: CSSProperties = {
  color: webTokens.textMuted,
  fontWeight: 500,
};

const showAll: CSSProperties = {
  alignSelf: "flex-start",
  padding: "2px 4px",
  background: "transparent",
  border: "none",
  color: webTokens.primary,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

function BalanceCell({
  line,
  className,
}: {
  line: TokenLine;
  className?: string;
}) {
  const amount = line.amount ?? "…";
  return (
    <div className={className} style={cell} title={`${amount} ${line.symbol}`}>
      <TokenMark line={line} size={22} />
      <span style={amountText}>
        {amount} <span style={unitText}>{line.symbol}</span>
      </span>
    </div>
  );
}

/**
 * Compact 2-column overview of the wallet's four headline balances
 * (BTC / XCP / KOR / ZELD — always all four, "0" when unheld), with an optional
 * "Show all" affordance. Designed to sit inside a wallet menu / popover.
 */
export function WalletBalanceSummary({
  onShowAll,
  showAllLabel = "Show all →",
  className,
  classNames,
  style,
}: WalletBalanceSummaryProps) {
  const { tokens } = useWalletTokenSummary();

  return (
    <div className={cx(classNames?.root, className)} style={{ ...root, ...style }}>
      <div className={classNames?.header} style={header}>
        Balances
      </div>
      <div className={classNames?.grid} style={grid}>
        {tokens.map((line) => (
          <BalanceCell key={line.symbol} line={line} className={classNames?.cell} />
        ))}
      </div>
      {onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className={classNames?.showAll}
          style={showAll}
        >
          {showAllLabel}
        </button>
      )}
    </div>
  );
}
