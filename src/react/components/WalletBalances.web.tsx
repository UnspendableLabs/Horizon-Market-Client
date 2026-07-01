import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
  gap: webTokens.spacingMd,
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

// BTC headline — the largest, top-of-page balance (no border, no fill).
const btcCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingMd,
  padding: webTokens.spacingSm,
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

// XCP / KOR / ZELD sit together on one row (borderless cells).
const tokenGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: webTokens.spacingSm,
};

const tokenCell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  minWidth: 0,
  padding: webTokens.spacingSm,
};

const tokenAmount: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const tokenSymbol: CSSProperties = {
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
};

const groupHeader: CSSProperties = {
  marginTop: webTokens.spacingSm,
  fontSize: webTokens.fontSizeSm,
  fontWeight: 600,
  color: webTokens.textMuted,
};

// "Other holdings" grid — media on top, label below, like the swap list.
const othersGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: webTokens.spacingMd,
  marginTop: webTokens.spacingSm,
};

const tile: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
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

const tileName: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 600,
};

const tileSub: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  fontVariantNumeric: "tabular-nums",
};

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

/** XCP / KOR / ZELD headline cell: brand mark + amount + symbol. */
function TokenCell({ line, className }: { line: TokenLine; className?: string }) {
  return (
    <div className={className} style={tokenCell} title={`${line.amount ?? "…"} ${line.symbol}`}>
      <TokenMark line={line} size={30} />
      <div style={{ minWidth: 0 }}>
        <div style={tokenAmount}>{line.amount ?? "…"}</div>
        <div style={tokenSymbol}>{line.symbol}</div>
      </div>
    </div>
  );
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

/** A single "other holding" tile: media on top, name + balance below. */
function OtherAssetTile({
  asset,
  className,
}: {
  asset: AssetOption;
  className?: string;
}) {
  const { name, sub } = otherLabel(asset);
  return (
    <div className={className} style={tile}>
      <AssetMedia asset={asset} />
      <span style={tileName} title={name}>
        {name}
      </span>
      {sub && (
        <span style={tileSub} title={sub}>
          {sub}
        </span>
      )}
    </div>
  );
}

/**
 * Full wallet balances list: the BTC balance shown large at the top, then the
 * XCP / KOR / ZELD headline tokens (always present) on one row, then every
 * other holding in a swap-list-style grid (artwork on top, balance below),
 * grouped by kind (Counterparty · Kontor · Ordinals).
 */
export function WalletBalances({
  className,
  classNames,
  style,
}: WalletBalancesProps) {
  const { btc, btcSats, primary, others, isFetching, lastFetchedAt, refresh } =
    useWalletTokenSummary();
  const { btcUsd } = usePrices();

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
        <TokenMark line={btc} size={44} />
        <div style={{ minWidth: 0 }}>
          <div>
            <span style={btcAmount}>{btc.amount ?? "…"}</span>{" "}
            <span style={btcUnit}>BTC</span>
          </div>
          {usd && <div style={btcUsdText}>{usd}</div>}
        </div>
      </div>

      <div style={tokenGrid}>
        {primary.map((line) => (
          <TokenCell key={line.symbol} line={line} className={classNames?.token} />
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
                <OtherAssetTile key={assetKey(a)} asset={a} className={classNames?.tile} />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
