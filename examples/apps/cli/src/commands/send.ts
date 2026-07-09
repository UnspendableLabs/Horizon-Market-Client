import { defineCommand } from "citty";
import pc from "picocolors";
import type { SendRequest } from "@unspendablelabs/horizon-market-client";
import { globalArgs } from "../context.js";
import { CliError, runCommand } from "../lib/output.js";
import { getNetworkConfig, mempoolApiBase, mempoolTxUrl } from "../lib/networks.js";
import { requireKeystore } from "../lib/keystore.js";
import { unlockWallet } from "../lib/wallet.js";
import { createClient } from "../lib/client.js";
import { findCounterpartyAsset, findZeldAsset } from "../lib/assets.js";
import { protectedUtxoIds, resolveInscriptionUtxo } from "../lib/ordinals.js";
import { fetchBtcUsd } from "../lib/prices.js";
import { confirmAction, requireScriptableWrite, resolvePassword } from "../lib/prompt.js";
import { toBaseUnits } from "../lib/format.js";
import { renderSendReview, resolveFeeRate } from "../lib/review.js";

type SendType = "btc" | "counterparty" | "zeld" | "ordinal" | "kor" | "kontor-nft";
const SEND_TYPES: SendType[] = ["btc", "counterparty", "zeld", "ordinal", "kor", "kontor-nft"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const sendCommand = defineCommand({
  meta: {
    name: "send",
    description: "Send / withdraw any asset type (unlocks the keystore)",
  },
  args: {
    ...globalArgs,
    type: {
      type: "string",
      required: true,
      description: "btc | counterparty | zeld | ordinal | kor | kontor-nft",
    },
    asset: { type: "string", description: "Asset name (counterparty)" },
    to: { type: "string", required: true, description: "Recipient address (P2TR for kor / kontor-nft)" },
    amount: { type: "string", description: "Amount for fungibles (btc / counterparty / zeld / kor)" },
    utxo: { type: "string", description: "Ordinal holding UTXO (txid:vout)" },
    inscription: { type: "string", description: "Ordinal inscription id (resolved to its UTXO)" },
    "nft-id": { type: "string", description: "Kontor NFT id (kontor-nft)" },
    "nft-contract": { type: "string", description: "Kontor NFT contract address (kontor-nft)" },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      requireScriptableWrite(cli);
      const type = String(ctx.args.type) as SendType;
      if (!SEND_TYPES.includes(type)) throw new CliError(`Invalid --type "${type}"`, "BAD_TYPE");
      const toAddress = str(ctx.args.to);
      if (!toAddress) throw new CliError("--to <address> is required", "MISSING_TO");

      const stored = requireKeystore(cli.homeDir);
      const cfg = getNetworkConfig(cli.networkOverride ?? stored.network);

      const password = await resolvePassword(cli);
      const unlocked = await unlockWallet(stored, password, cfg.sdkNetwork, cli.passphrase);
      const client = createClient(cfg, {
        mnemonic: unlocked.mnemonic,
        mnemonicOptions: unlocked.mnemonicOptions,
      });
      const { p2wpkh, p2tr } = unlocked.addresses;

      const satsPerVbyte = await resolveFeeRate(fetch, mempoolApiBase(cfg), cli.feeRate);

      // Build the SendRequest (mirrors useWithdraw's buildRequest).
      let request: SendRequest;
      let heading = "";
      if (type === "btc") {
        const amount = str(ctx.args.amount);
        if (!amount) throw new CliError("--amount is required for btc", "MISSING_AMOUNT");
        const amountSats = toBaseUnits(amount, true);
        if (amountSats <= 0n) throw new CliError("--amount must be greater than 0", "BAD_AMOUNT");
        request = { kind: "btc", toAddress, amountSats, satsPerVbyte };
        heading = `Send ${amount} BTC to ${toAddress}`;
      } else if (type === "counterparty") {
        const asset = str(ctx.args.asset);
        const amount = str(ctx.args.amount);
        if (!asset) throw new CliError("--asset is required for counterparty", "MISSING_ASSET");
        if (!amount) throw new CliError("--amount is required for counterparty", "MISSING_AMOUNT");
        const owned = await findCounterpartyAsset(client, unlocked.addresses, asset);
        const quantity = toBaseUnits(amount, owned.divisible);
        if (quantity <= 0n) throw new CliError("--amount must be greater than 0", "BAD_AMOUNT");
        if (quantity > owned.balance) throw new CliError("--amount exceeds your balance", "INSUFFICIENT");
        request = {
          kind: "counterparty",
          fromAddress: owned.address,
          asset: owned.assetName,
          toAddress,
          quantity,
          divisible: owned.divisible,
          satsPerVbyte,
        };
        heading = `Send ${amount} ${owned.assetName} to ${toAddress}`;
      } else if (type === "zeld") {
        const amount = str(ctx.args.amount);
        if (!amount) throw new CliError("--amount is required for zeld", "MISSING_AMOUNT");
        const owned = await findZeldAsset(client, unlocked.addresses);
        const zeldAmount = toBaseUnits(amount, true);
        if (zeldAmount <= 0n) throw new CliError("--amount must be greater than 0", "BAD_AMOUNT");
        if (zeldAmount > owned.balance) throw new CliError("--amount exceeds your balance", "INSUFFICIENT");
        request = { kind: "zeld", fromAddress: owned.address, toAddress, amount: zeldAmount, satsPerVbyte };
        heading = `Send ${amount} ZELD to ${toAddress}`;
      } else if (type === "ordinal") {
        const utxo = str(ctx.args.utxo);
        const inscription = str(ctx.args.inscription);
        const utxoId =
          utxo ??
          (inscription
            ? await resolveInscriptionUtxo(fetch, cfg.ordApiBaseUrl, inscription)
            : undefined);
        if (!utxoId) throw new CliError("Provide --utxo <txid:vout> or --inscription <id>", "MISSING_UTXO");
        request = { kind: "ordinal", fromAddress: p2tr, utxoId, toAddress, satsPerVbyte };
        heading = `Send inscription ${utxoId} to ${toAddress}`;
      } else if (type === "kor") {
        const amount = str(ctx.args.amount);
        if (!amount) throw new CliError("--amount is required for kor", "MISSING_AMOUNT");
        request = { kind: "kor", toAddress, amount, satsPerVbyte };
        heading = `Send ${amount} KOR to ${toAddress}`;
      } else {
        const nftId = str(ctx.args["nft-id"]);
        const nftContract = str(ctx.args["nft-contract"]) ?? cfg.kontorNftContractAddress;
        if (!nftId) throw new CliError("--nft-id is required for kontor-nft", "MISSING_NFT_ID");
        if (!nftContract) throw new CliError("--nft-contract is required for kontor-nft", "MISSING_NFT_CONTRACT");
        request = { kind: "kontor-nft", contractAddress: nftContract, nftId, toAddress, satsPerVbyte };
        heading = `Send NFT ${nftId} to ${toAddress}`;
      }

      // Exclude inscription UTXOs from plain-BTC funding (best-effort asset safety).
      const protectedIds = await protectedUtxoIds(fetch, cfg.ordApiBaseUrl, [p2wpkh, p2tr]);
      const prepared = await client.prepareSend(request, { protectedUtxoIds: protectedIds });

      if (!cli.json) {
        const btcUsd = await fetchBtcUsd(fetch);
        renderSendReview(heading, prepared.feeSats, btcUsd);
      }
      await confirmAction(cli, "Broadcast this transaction?");

      const { txid } = await prepared.broadcast();
      const explorer = mempoolTxUrl(cfg, txid);

      return {
        json: { request, feeSats: prepared.feeSats, txid, explorer },
        human: () => {
          console.log(pc.green(`\n✔ Broadcast — tx ${txid}`));
          if (explorer) console.log(pc.dim(`  ${explorer}`));
        },
      };
    });
  },
});
