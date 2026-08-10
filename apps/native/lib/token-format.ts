/**
 * Display formatting for the token screens.
 *
 * The API deliberately sends typed, machine-readable values and no display
 * strings — it has no idea what locale or width it renders into — so every
 * number, timestamp and address is formatted here.
 */

/** Group-separated sats ("3,450"). */
export function formatSats(sats: number): string {
  return Math.round(sats).toLocaleString("en-US");
}

/**
 * A sats amount as BTC, with just enough precision to stay honest: small
 * amounts stay in sats rather than rendering as "0.00000000 BTC", and the
 * decimals shrink as the figure grows, so a market cap fits one line instead of
 * being truncated mid-number by the tile that shows it.
 */
export function formatSatsAsBtc(sats: number): string {
  if (!Number.isFinite(sats)) return "—";
  if (Math.abs(sats) < 100_000) return `${formatSats(sats)} sats`;
  const btc = sats / 1e8;
  const abs = Math.abs(btc);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return `${btc.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  })} BTC`;
}

/** Group-separated count ("1,234"), or an em dash for a missing value. */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

/**
 * A decimal-string quantity or supply, grouped for reading. Kept as a string
 * throughout: these are bigint at rest and exceed float precision, so parsing
 * one into a `number` to format it would silently round it.
 *
 * The fraction is cut to `maxDecimals` for display — a divisible supply carries
 * eight of them, and a nine-figure whole part plus eight decimals does not fit
 * a stat tile, so it would be truncated mid-number anyway. The whole part is
 * never touched.
 */
export function formatDecimalString(
  value: string | null | undefined,
  maxDecimals = 4,
): string {
  if (!value) return "—";
  const [whole, fraction] = value.split(".");
  const grouped = (whole ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Trailing zeros carry no information for a display figure ("298.00000000").
  const trimmed = fraction?.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/**
 * Plain text out of a value that may carry markup.
 *
 * A Counterparty asset description is free-form and frequently holds raw HTML
 * (`<br /><img src="…">`), which a React Native `<Text>` renders verbatim — so
 * the screen would show the markup instead of the description. Returns `null`
 * when nothing but markup was there.
 */
export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text;
}

/** "3 min ago" / "5 days ago" from an RFC 3339 timestamp. */
export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 31) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A full date-time, for a value the user may want to read exactly. */
export function formatDateTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  return new Date(at).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "bc1qabcd…wxyz" — long identifiers, shortened from both ends. */
export function truncateMiddle(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * mempool.space transaction URL for the active network. Signet shares the SDK's
 * `testnet` Bitcoin params, so it is distinguished by `kontorNetwork`, exactly
 * as the SDK's own swap tiles do.
 */
export function mempoolTxUrl(
  network: "mainnet" | "testnet",
  kontorNetwork: "signet" | undefined,
  txid: string | null | undefined,
): string | null {
  if (!txid) return null;
  const base =
    network === "mainnet"
      ? "https://mempool.space"
      : kontorNetwork === "signet"
        ? "https://mempool.space/signet"
        : "https://mempool.space/testnet";
  return `${base}/tx/${txid}`;
}
