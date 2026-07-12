import os from "node:os";
import path from "node:path";
import type { ArgsDef } from "citty";
import { CliError } from "./lib/output.js";
import { isUiNetwork, type UiNetwork } from "./lib/networks.js";

/**
 * Global flags shared by every command. Spread into each subcommand's `args` so
 * `ctx.args` carries them; {@link resolveContext} turns them into a {@link CliContext}.
 */
export const globalArgs = {
  json: {
    type: "boolean",
    description: "Machine-readable JSON output (implies no color / spinner / prompt)",
    default: false,
  },
  network: {
    type: "string",
    description: "Network: mainnet | signet (default: the keystore's network, else mainnet)",
  },
  home: {
    type: "string",
    description: "Keystore home directory (overrides $HORIZON_HOME; default ~/.horizon)",
  },
  "auto-confirm": {
    type: "boolean",
    description: "Skip the interactive confirmation on write commands",
    default: false,
  },
  "fee-rate": {
    type: "string",
    description: "Fee rate for write commands: slow | normal | fast | <sat/vByte>",
  },
  passphrase: {
    type: "string",
    description:
      "BIP39 passphrase to unlock a wallet created with one (overrides $HORIZON_PASSPHRASE)",
  },
} satisfies ArgsDef;

/** Resolved global execution context for a single command invocation. */
export interface CliContext {
  /** JSON mode: set via `--json` or whenever stdout is not a TTY. */
  json: boolean;
  /** True when both stdin and stdout are TTYs (interactive prompts possible). */
  isTty: boolean;
  /** Skip write-command confirmations. */
  autoConfirm: boolean;
  /** Absolute keystore home directory. */
  homeDir: string;
  /** `--network` override, or undefined (fall back to the keystore's network). */
  networkOverride: UiNetwork | undefined;
  /** Raw `--fee-rate` value (`slow`/`normal`/`fast`/number string), or undefined. */
  feeRate: string | undefined;
  /** BIP39 passphrase for unlocking: `--passphrase` flag, else `$HORIZON_PASSPHRASE`. */
  passphrase: string | undefined;
}

/** Build the {@link CliContext} from a command's parsed `ctx.args`. */
export function resolveContext(args: Record<string, unknown>): CliContext {
  const homeArg = typeof args.home === "string" ? args.home : undefined;
  const homeDir =
    homeArg ??
    (process.env.HORIZON_HOME?.trim() || path.join(os.homedir(), ".horizon"));

  const networkArg = typeof args.network === "string" ? args.network : undefined;
  if (networkArg && !isUiNetwork(networkArg)) {
    throw new CliError(
      `Invalid --network "${networkArg}" (expected "mainnet" or "signet")`,
      "BAD_NETWORK",
    );
  }

  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const json = Boolean(args.json) || !process.stdout.isTTY;

  // `--passphrase` wins over $HORIZON_PASSPHRASE; both are optional.
  const passphraseArg =
    typeof args.passphrase === "string" && args.passphrase ? args.passphrase : undefined;
  const passphrase = passphraseArg ?? (process.env.HORIZON_PASSPHRASE?.trim() || undefined);

  return {
    json,
    isTty,
    autoConfirm: Boolean(args["auto-confirm"]),
    homeDir: path.resolve(homeDir),
    networkOverride: networkArg as UiNetwork | undefined,
    feeRate: typeof args["fee-rate"] === "string" ? args["fee-rate"] : undefined,
    passphrase,
  };
}
