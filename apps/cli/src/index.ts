import fs from "node:fs";
import pc from "picocolors";
import {
  defineCommand,
  renderUsage,
  runCommand as runCittyCommand,
  type ArgsDef,
  type CommandDef,
} from "citty";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { balancesCommand } from "./commands/balances.js";
import { sellCommand } from "./commands/sell.js";
import { buyCommand } from "./commands/buy.js";
import { sendCommand } from "./commands/send.js";

/**
 * Injected at build time (tsup `define`) with the publishing package's version —
 * the SDK's version both when bundled as the package bin and when built here
 * standalone. Undefined under `tsx` in dev, hence the fallback.
 */
declare const __HORIZON_CLI_VERSION__: string | undefined;
const version =
  typeof __HORIZON_CLI_VERSION__ === "string" ? __HORIZON_CLI_VERSION__ : "0.0.0-dev";

const subCommands = {
  init: initCommand,
  list: listCommand,
  balances: balancesCommand,
  sell: sellCommand,
  buy: buyCommand,
  send: sendCommand,
};

const main = defineCommand({
  meta: {
    name: "horizon",
    version,
    description: "Horizon Market CLI — init / list / balances / sell / buy / send",
  },
  subCommands,
});

// `horizon list | head` style consumers can close stdout early; treat EPIPE as
// a clean stop instead of dying with a raw stack trace.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const rawArgs = process.argv.slice(2);
// Argument-parse errors happen before any command body runs, so the output mode
// must be derived from raw argv (same rule as resolveContext).
const jsonMode = rawArgs.includes("--json") || !process.stdout.isTTY;

/** Usage text for the invoked subcommand when known, else the root command. */
async function usage(): Promise<string> {
  const name = rawArgs.find((a) => !a.startsWith("-"));
  // Widen to the generic CommandDef: each subcommand has its own `args` type
  // and renderUsage would otherwise try to unify the union.
  const sub: CommandDef<ArgsDef> | undefined =
    name && Object.hasOwn(subCommands, name)
      ? (subCommands[name as keyof typeof subCommands] as CommandDef<ArgsDef>)
      : undefined;
  return renderUsage(sub ?? (main as CommandDef<ArgsDef>), sub ? (main as CommandDef<ArgsDef>) : undefined);
}

/**
 * Thin replacement for citty's `runMain`: same `--help` / `--version` builtins,
 * but argument-parse errors honor the `--json` contract — a JSON envelope on
 * stderr and nothing on stdout — instead of citty's stdout usage dump. Command
 * bodies never throw out of `runCittyCommand`: `runCommand` in lib/output.ts
 * catches, emits, and exits, so this catch only sees citty parse errors.
 */
async function run(): Promise<void> {
  try {
    if (rawArgs.some((a) => a === "--help" || a === "-h")) {
      console.log((await usage()) + "\n");
    } else if (rawArgs.length === 1 && (rawArgs[0] === "--version" || rawArgs[0] === "-v")) {
      console.log(version);
    } else {
      await runCittyCommand(main, { rawArgs });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Same channel rules as lib/output's fail(): writeSync so the payload
    // survives `process.exit` on platforms where piped stderr is async.
    if (jsonMode) {
      fs.writeSync(2, JSON.stringify({ error: { message, code: "USAGE" } }) + "\n");
    } else {
      fs.writeSync(2, (await usage()) + "\n" + pc.red(`✖ ${message}`) + "\n");
    }
    process.exit(1);
  }
}

void run();
