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
import { resolvePassword } from "../lib/prompt.js";
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
      description: "Import an existing BIP39 mnemonic (else a fresh one is generated)",
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

      const account = Number(ctx.args.account);
      if (!Number.isInteger(account) || account < 0) {
        throw new CliError("--account must be a non-negative integer", "BAD_ACCOUNT");
      }

      const provided =
        typeof ctx.args.mnemonic === "string" ? ctx.args.mnemonic.trim() : "";
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
