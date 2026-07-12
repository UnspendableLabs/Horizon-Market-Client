import { defineCommand } from "citty";
import pc from "picocolors";
import {
  generateMnemonic,
  validateMnemonic,
  encryptKeystore,
} from "@unspendablelabs/horizon-market-client";
import { globalArgs } from "../context.js";
import { CliError, note, runCommand } from "../lib/output.js";
import { getNetworkConfig } from "../lib/networks.js";
import { keystoreExists, writeKeystore, type StoredKeystore } from "../lib/keystore.js";
import { deriveWallet } from "../lib/wallet.js";
import { resolveMnemonicImport, resolvePassword } from "../lib/prompt.js";
import { kv } from "../lib/format.js";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Create (or import) an encrypted wallet keystore",
  },
  args: {
    ...globalArgs,
    mnemonic: {
      type: "positional",
      required: false,
      description:
        "Import an existing BIP39 mnemonic (DISCOURAGED — lands in shell history; prefer --import)",
    },
    import: {
      type: "boolean",
      description: "Import an existing mnemonic via hidden prompt (TTY) or stdin (piped)",
      default: false,
    },
    words: {
      type: "string",
      description: "Word count for a generated mnemonic: 12 or 24 (default 24)",
      default: "24",
    },
    account: {
      type: "string",
      description:
        "BIP32 account index (Horizon Wallet convention m/{84,86}'/{coin}'/<account>'/0/0; default 0)",
      default: "0",
    },
    passphrase: {
      type: "string",
      description: "BIP39 passphrase (\"25th word\") — remember it: it is NOT stored",
    },
    force: {
      type: "boolean",
      description: "Overwrite an existing keystore",
      default: false,
    },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      if (keystoreExists(cli.homeDir) && !ctx.args.force) {
        throw new CliError(
          `A keystore already exists in ${cli.homeDir}. Pass --force to overwrite.`,
          "KEYSTORE_EXISTS",
        );
      }

      const cfg = getNetworkConfig(cli.networkOverride ?? "mainnet");

      const words = String(ctx.args.words);
      if (words !== "12" && words !== "24") {
        throw new CliError('--words must be "12" or "24"', "BAD_WORDS");
      }

      // Strict decimal digits only (`Number()` would accept "0x2", "1e2", "");
      // BIP32 hardened child indexes must fit below 2^31.
      const accountRaw = String(ctx.args.account);
      const account = /^\d+$/.test(accountRaw) ? Number(accountRaw) : Number.NaN;
      if (!Number.isInteger(account) || account < 0 || account >= 2 ** 31) {
        throw new CliError(
          "--account must be a non-negative integer below 2^31",
          "BAD_ACCOUNT",
        );
      }

      let provided =
        typeof ctx.args.mnemonic === "string" ? ctx.args.mnemonic.trim() : "";
      if (provided) {
        // The argv path persists the phrase in shell history and exposes it via
        // `ps` for the process lifetime — steer users to --import.
        note(cli, "⚠ Mnemonic passed as an argument can leak via shell history — prefer `horizon init --import`.");
      } else if (ctx.args.import) {
        provided = await resolveMnemonicImport(cli);
      }
      let mnemonic: string;
      if (provided) {
        if (!validateMnemonic(provided)) {
          throw new CliError("The provided mnemonic is invalid (BIP39 checksum failed)", "BAD_MNEMONIC");
        }
        mnemonic = provided;
      } else {
        mnemonic = generateMnemonic(words === "12" ? 128 : 256);
      }

      // Resolve via the shared getter (flag OR $HORIZON_PASSPHRASE) so a wallet
      // created with the env passphrase matches what the unlock commands later
      // re-derive with — otherwise init would silently make a no-passphrase wallet
      // and every write command would then fail with DERIVATION_MISMATCH.
      const passphrase = cli.passphrase;

      const wallet = deriveWallet(mnemonic, { account, passphrase });
      const password = await resolvePassword(cli, { confirm: true });
      const blob = await encryptKeystore(mnemonic, password);

      const stored: StoredKeystore = {
        version: 2,
        network: cfg.uiNetwork,
        account,
        addresses: wallet.addresses,
        createdAt: new Date().toISOString(),
        keystore: blob,
      };
      writeKeystore(cli.homeDir, stored);

      const addresses = wallet.addresses[cfg.sdkNetwork];

      // The JSON payload contains the cleartext phrase (the only scriptable way
      // to capture it). Redirection auto-enables JSON mode, so warn on stderr —
      // it never pollutes the stdout contract.
      if (cli.json) {
        process.stderr.write(
          "⚠ The recovery phrase is included in this JSON output — secure or delete anything that captured it.\n",
        );
      }

      return {
        json: {
          created: true,
          network: cfg.uiNetwork,
          mnemonic,
          addresses,
        },
        human: () => {
          note(cli, `Keystore written to ${cli.homeDir}/keystore.json (0600)`);
          console.log(pc.bold(`\n✔ Wallet ready on ${cfg.label}`));
          console.log(pc.yellow("\n  ⚠ Write down your recovery phrase — it is shown ONLY once:\n"));
          console.log(pc.bold(`    ${mnemonic}\n`));
          console.log(kv("Segwit (p2wpkh)", addresses.p2wpkh));
          console.log(kv("Taproot (p2tr)", addresses.p2tr));
        },
      };
    });
  },
});
