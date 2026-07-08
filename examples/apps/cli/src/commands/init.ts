import { defineCommand } from "citty";
import pc from "picocolors";
import {
  generateMnemonic,
  validateMnemonic,
  encryptKeystore,
  DEFAULT_DERIVATION_PATH,
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
    path: {
      type: "string",
      description: "BIP32 derivation path (default m/86'/0'/0'/0/0)",
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

      const derivationPath =
        typeof ctx.args.path === "string" && ctx.args.path
          ? ctx.args.path
          : DEFAULT_DERIVATION_PATH;
      const passphrase =
        typeof ctx.args.passphrase === "string" && ctx.args.passphrase
          ? ctx.args.passphrase
          : undefined;

      const wallet = deriveWallet(mnemonic, { path: derivationPath, passphrase });
      const password = await resolvePassword(cli, { confirm: true });
      const blob = await encryptKeystore(mnemonic, password);

      const stored: StoredKeystore = {
        version: 1,
        network: cfg.uiNetwork,
        path: derivationPath,
        publicKey: wallet.publicKey,
        xOnlyPubkey: wallet.xOnlyPubkey,
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
