/**
 * Kontor gas pricing — the arithmetic half of the pre-flight checks.
 *
 * Deliberately free of any `@kontor/sdk` import: the React layer needs these
 * numbers to size a "Max" button, and the SDK entry point pulls in the Kontor
 * WASM backend. Everything here is pure string/number math over values the
 * client already holds, so it stays safe to import from a browser bundle that
 * must not load Kontor at all. {@link ./preflight.ts} re-exports the lot.
 */

/**
 * Token cost of one gas unit. Node-side constant
 * (`Runtime::gas_to_token_multiplier`, currently `1e-9`), not exposed by the
 * indexer API — mirrored here so the client can price an op's gas up front.
 */
const GAS_TO_TOKEN_DECIMALS = 9;

/**
 * Gas the SDK commits for the seller's attach reveal — `KontorSession`'s
 * default gas limit, which `Attachment.offer()` inherits. Self-paid by the
 * seller (no Sponsor rides the attach).
 */
export const KONTOR_ATTACH_GAS_LIMIT = 100_000;

/**
 * Gas the buyer's `Sponsor` op commits in `IncomingOffer.accept()` (hard-coded
 * in the SDK).
 *
 * The Sponsor op itself never dispatches to a contract, so it holds nothing; it
 * *overrides* the payment of the seller's pre-signed `detach` in the next input
 * — "override replaces both payer and cap" — so the one metered op in a swap
 * reveal is the detach, charged to the **buyer** at the Sponsor's limit, not at
 * the detach's own.
 */
export const KONTOR_ACCEPT_GAS_LIMIT = 50_000;

/**
 * Gas the seller's `detach` commits when *revoking* an offer (delisting).
 *
 * No Sponsor rides a revoke, so the detach is paid by its own input's signer —
 * the seller — at the limit baked into the offer blob when it was composed
 * (`KontorSession`'s default). {@link detachGasLimitFromBlob} reads the real
 * value out of the blob; this is the fallback for a blob we can't parse.
 */
export const KONTOR_DETACH_GAS_LIMIT = 100_000;

/**
 * KOR cost of `gasLimit` gas, as a plain decimal string (e.g. `100000` →
 * `"0.0001"`). String math on the integer gas limit: shifting the decimal
 * point by `GAS_TO_TOKEN_DECIMALS` avoids float rounding entirely.
 */
export function korCostForGas(gasLimit: number): string {
  const gas = Math.max(0, Math.trunc(gasLimit));
  const digits = String(gas).padStart(GAS_TO_TOKEN_DECIMALS + 1, "0");
  const cut = digits.length - GAS_TO_TOKEN_DECIMALS;
  const whole = digits.slice(0, cut).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(cut).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Gas the `detach` in an offer blob commits to — what the seller must be able
 * to pay to revoke (delist) it.
 *
 * Read from the blob rather than assumed, because the limit was fixed when the
 * offer was composed (by that session's `defaultGasLimit`) and a blob signed by
 * an older or third-party client may not match today's default. The ops of one
 * input are held and settled in turn, so the requirement is the largest single
 * limit, not their sum. Falls back to {@link KONTOR_DETACH_GAS_LIMIT} for a blob
 * whose shape we don't recognise — never throws: this feeds a safety check, and
 * failing to *read* the limit must not be what blocks a delist.
 */
export function detachGasLimitFromBlob(blob: string): number {
  try {
    const data = JSON.parse(blob) as {
      detachInsts?: { ops?: Array<{ gas_limit?: unknown } | null> } | null;
    } | null;
    const ops = data?.detachInsts?.ops;
    if (!Array.isArray(ops) || ops.length === 0) return KONTOR_DETACH_GAS_LIMIT;
    let max = 0;
    for (const op of ops) {
      const limit = Number(op?.gas_limit);
      if (Number.isFinite(limit) && limit > max) max = limit;
    }
    return max > 0 ? max : KONTOR_DETACH_GAS_LIMIT;
  } catch {
    return KONTOR_DETACH_GAS_LIMIT;
  }
}

/** Split a plain decimal string into `{ negative, whole, frac }`, or null. */
function parseDecimal(
  value: string,
): { negative: boolean; whole: string; frac: string } | null {
  const match = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(value);
  if (!match) return null;
  const whole = match[2] ?? "";
  const frac = match[3] ?? "";
  if (!whole && !frac) return null;
  return { negative: match[1] === "-", whole, frac };
}

/**
 * `a - b` over two plain decimal strings, or null when either doesn't parse.
 * Clamped at zero — the only caller wants "what's left", and a negative
 * remainder means "nothing".
 *
 * Scales both to a common integer with `BigInt` rather than going through
 * `Number`: KOR amounts are arbitrary-precision decimals on the wire and a
 * float round-trip would quietly move the last digits of a balance.
 */
export function subtractKor(a: string, b: string): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right || left.negative || right.negative) return null;

  const scale = Math.max(left.frac.length, right.frac.length);
  const scaled = (d: { whole: string; frac: string }): bigint =>
    BigInt((d.whole || "0") + d.frac.padEnd(scale, "0"));

  const diff = scaled(left) - scaled(right);
  if (diff <= 0n) return "0";

  const digits = diff.toString().padStart(scale + 1, "0");
  const cut = digits.length - scale;
  const whole = digits.slice(0, cut).replace(/^0+(?=\d)/, "");
  const frac = digits.slice(cut).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * The most KOR a wallet holding `balance` can actually list: its balance minus
 * the gas the listing's own `attach` op holds.
 *
 * Escrowing KOR and paying for the op that escrows it draw on one balance, and
 * the node takes the gas hold *first* — so "list everything" is always one
 * failed op. Returns null when nothing is listable (or `balance` is unparseable),
 * so a caller can hide the affordance rather than offer a zero.
 */
export function maxListableKor(balance: string): string | null {
  const max = subtractKor(balance, korCostForGas(KONTOR_ATTACH_GAS_LIMIT));
  return max === null || max === "0" ? null : max;
}
