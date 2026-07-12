import * as clack from "@clack/prompts";
import type { WorkflowProgressEvent } from "@unspendablelabs/horizon-market-client";
import type { CliContext } from "../context.js";
import { CliError } from "./output.js";

/**
 * Resolve the keystore password: `HORIZON_PASSWORD` env first, else an
 * interactive `@clack/prompts` password prompt. In `--json` / non-TTY mode the
 * prompt is impossible, so the env var is REQUIRED.
 *
 * @param opts.confirm Prompt twice and require a match (used by `init`).
 */
export async function resolvePassword(
  cli: CliContext,
  opts: { confirm?: boolean } = {},
): Promise<string> {
  const env = process.env.HORIZON_PASSWORD;
  if (env) return env;

  if (cli.json || !cli.isTty) {
    throw new CliError(
      "Password required: set HORIZON_PASSWORD (no interactive prompt in --json / non-TTY mode).",
      "PASSWORD_REQUIRED",
    );
  }

  const pw = await clack.password({
    message: "Keystore password",
    validate: (v) => (!v || v.length === 0 ? "Password must not be empty" : undefined),
  });
  if (clack.isCancel(pw)) throw new CliError("Cancelled", "CANCELLED");

  if (opts.confirm) {
    const pw2 = await clack.password({ message: "Confirm password" });
    if (clack.isCancel(pw2)) throw new CliError("Cancelled", "CANCELLED");
    if (pw2 !== pw) throw new CliError("Passwords do not match", "PASSWORD_MISMATCH");
  }
  return pw;
}

/**
 * Guard a scriptable write: in `--json` mode a confirmation prompt is impossible,
 * so `--auto-confirm` is mandatory. Fails fast (before any network / unlock) so
 * scripts get a clean, deterministic error. `init` is exempt — it has no confirm
 * step (only a password).
 */
export function requireScriptableWrite(cli: CliContext): void {
  if (cli.json && !cli.autoConfirm) {
    throw new CliError(
      "Write commands in --json mode require --auto-confirm (and HORIZON_PASSWORD).",
      "CONFIRM_REQUIRED",
    );
  }
}

/**
 * Interactive yes/no confirmation for a write command. `--auto-confirm` (or a
 * non-interactive session) skips the prompt and proceeds; a declined prompt
 * throws a clean "Aborted".
 */
export async function confirmAction(cli: CliContext, message: string): Promise<void> {
  if (cli.autoConfirm) return;
  if (cli.json || !cli.isTty) {
    // A prompt is impossible here — writes must pass --auto-confirm explicitly.
    throw new CliError(
      "Confirmation required: pass --auto-confirm (no interactive prompt in --json / non-TTY mode).",
      "CONFIRM_REQUIRED",
    );
  }
  const ok = await clack.confirm({ message });
  if (clack.isCancel(ok) || !ok) throw new CliError("Aborted", "ABORTED");
}

/**
 * Build the workflow `onProgress` callback. In TTY mode it prints step messages
 * to stderr (keeping stdout clean for output); in `--json` mode it is suppressed
 * (returns undefined) so nothing pollutes the machine output.
 */
export function makeProgress(
  cli: CliContext,
): ((event: WorkflowProgressEvent) => void) | undefined {
  if (cli.json) return undefined;
  return (event) => {
    const step =
      event.totalSteps != null ? `[${event.stepIndex}/${event.totalSteps}] ` : "";
    process.stderr.write(`  ${step}${event.message}\n`);
  };
}
