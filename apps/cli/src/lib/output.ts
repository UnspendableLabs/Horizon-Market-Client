import fs from "node:fs";
import pc from "picocolors";
import { resolveContext, type CliContext } from "../context.js";

/** A CLI error that can carry a machine-readable `code` for `--json` output. */
export class CliError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

/**
 * Machine-readable codes for the SDK errors a script has to branch on.
 *
 * The SDK identifies them by `name` (it has no CLI code vocabulary), and the
 * pre-flight ones especially need to be distinguishable from a generic failure:
 * "you need KOR before you can list" is a *fund-and-retry*, whereas the
 * `…NotRecordedError`s mean the chain already moved and retrying the command
 * would double-spend the attempt. Without a code, `--json` consumers would have
 * to grep the message.
 */
const SDK_ERROR_CODES: Record<string, string> = {
  KontorInsufficientGasError: "KONTOR_INSUFFICIENT_GAS",
  KontorAssetUnavailableError: "KONTOR_ASSET_UNAVAILABLE",
  KontorEscrowNotFundedError: "KONTOR_ESCROW_NOT_FUNDED",
  KontorListingNotRecordedError: "KONTOR_LISTING_NOT_RECORDED",
  KontorPurchaseNotRecordedError: "KONTOR_PURCHASE_NOT_RECORDED",
  KontorDelistNotRecordedError: "KONTOR_DELIST_NOT_RECORDED",
  KontorUnavailableError: "KONTOR_UNAVAILABLE",
  ZeldTooManyUtxosError: "ZELD_TOO_MANY_UTXOS",
};

/** The `--json` error code for a thrown value, or undefined when it has none. */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof CliError) return err.code;
  if (err instanceof Error) return SDK_ERROR_CODES[err.name];
  return undefined;
}

/** JSON.stringify replacer: serialize bigint → decimal string (lossless). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** What a command returns: the JSON payload + a human renderer (called only in TTY mode). */
export interface CommandOutput {
  json: unknown;
  human: () => void;
}

/**
 * Resolve the {@link CliContext} from raw args and run a command handler with
 * unified success / error emission:
 *  - `--json` (or non-TTY stdout): serialize `json` to stdout (bigint→string),
 *    exit 0; on error print `{ error: { message, code? } }` to stderr, exit 1.
 *  - TTY: call `human()`; on error print a red message to stderr, exit 1.
 *
 * `resolveContext` runs INSIDE the try so a context failure (e.g. an invalid
 * `--network`) is still reported through the correct channel — a JSON envelope
 * in `--json`/non-TTY mode — instead of escaping as an uncaught throw.
 */
export async function runCommand(
  args: Record<string, unknown>,
  handler: (cli: CliContext) => Promise<CommandOutput>,
): Promise<void> {
  // JSON mode, computed with NO throwing work so even a resolveContext failure
  // is emitted correctly. Mirrors resolveContext's own `json` derivation.
  const json = Boolean(args.json) || !process.stdout.isTTY;
  try {
    const cli = resolveContext(args);
    const out = await handler(cli);
    if (cli.json) {
      process.stdout.write(JSON.stringify(out.json, bigintReplacer, 2) + "\n");
    } else {
      out.human();
    }
  } catch (err) {
    fail(json, err);
  }
}

function fail(json: boolean, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);
  const line = json
    ? JSON.stringify({ error: code ? { message, code } : { message } }, bigintReplacer) + "\n"
    : pc.red(`✖ ${message}`) + "\n";
  // `writeSync` (not `process.stderr.write`): stderr pipe writes are async on
  // macOS/Windows and `process.exit` does not drain them — the error JSON that
  // scripts rely on (`2>err.json`) would be lost.
  fs.writeSync(2, line);
  process.exit(1);
}

/** Print an informational note to stderr in TTY mode (suppressed in --json). */
export function note(cli: CliContext, message: string): void {
  if (!cli.json) process.stderr.write(pc.dim(`  ${message}`) + "\n");
}
