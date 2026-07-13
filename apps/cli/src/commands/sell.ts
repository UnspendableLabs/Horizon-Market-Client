import { defineCommand } from "citty";
import pc from "picocolors";
import type { OpenSellOrderParams } from "@unspendablelabs/horizon-market-client";
import { globalArgs } from "../context.js";
import { CliError, runCommand } from "../lib/output.js";
import { getNetworkConfig, mempoolApiBase, mempoolTxUrl } from "../lib/networks.js";
import { requireKeystore } from "../lib/keystore.js";
import { unlockWallet } from "../lib/wallet.js";
import { createClient } from "../lib/client.js";
import { findCounterpartyAsset, findZeldAsset } from "../lib/assets.js";
import { resolveInscriptionUtxo } from "../lib/ordinals.js";
import { fetchBtcUsd } from "../lib/prices.js";
import {
  confirmAction,
  makeProgress,
  requireScriptableWrite,
  resolvePassword,
} from "../lib/prompt.js";
import { toBaseUnits } from "../lib/format.js";
import {
  previewSellCost,
  renderKontorSellReview,
  renderSellReview,
  resolveFeeRate,
  type SellCost,
  type SellPreviewParams,
} from "../lib/review.js";

type SellType = "counterparty" | "zeld" | "ordinal" | "kor" | "kontor-nft";
const SELL_TYPES: SellType[] = ["counterparty", "zeld", "ordinal", "kor", "kontor-nft"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export const sellCommand = defineCommand({
  meta: {
    name: "sell",
    description: "Open a sell order (unlocks the keystore)",
  },
  args: {
    ...globalArgs,
    type: {
      type: "string",
      required: true,
      description: "counterparty | zeld | ordinal | kor | kontor-nft",
    },
    asset: { type: "string", description: "Asset name (counterparty)" },
    amount: { type: "string", description: "Quantity for fungibles (counterparty / zeld / kor)" },
    price: { type: "string", required: true, description: "Net sats the seller receives" },
    utxo: { type: "string", description: "Ordinal holding UTXO (txid:vout)" },
    inscription: { type: "string", description: "Ordinal inscription id (resolved to its UTXO)" },
    "nft-id": { type: "string", description: "Kontor NFT id (kontor-nft)" },
    "nft-contract": { type: "string", description: "Kontor NFT contract address (kontor-nft)" },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      requireScriptableWrite(cli);
      const type = String(ctx.args.type) as SellType;
      if (!SELL_TYPES.includes(type)) {
        throw new CliError(`Invalid --type "${type}"`, "BAD_TYPE");
      }
      // Sats are integral — reject fractions ("0.5" suggests BTC, off by 1e8)
      // and float-imprecise magnitudes.
      const price = Number(ctx.args.price);
      if (!Number.isInteger(price) || price <= 0 || price > Number.MAX_SAFE_INTEGER) {
        throw new CliError("--price must be a positive integer number of sats", "BAD_PRICE");
      }

      const stored = requireKeystore(cli.homeDir);
      const cfg = getNetworkConfig(cli.networkOverride ?? stored.network);

      // Kontor is signet-only: fail before unlocking/prompting, mirroring `list`.
      if ((type === "kor" || type === "kontor-nft") && cfg.kontorNetwork !== "signet") {
        throw new CliError(
          "Kontor is signet-only — pass --network signet to sell KOR / Kontor NFTs.",
          "KONTOR_UNAVAILABLE",
        );
      }

      const password = await resolvePassword(cli);
      const unlocked = await unlockWallet(stored, password, cfg.sdkNetwork, cli.passphrase);
      const client = createClient(cfg, {
        mnemonic: unlocked.mnemonic,
        mnemonicOptions: unlocked.mnemonicOptions,
      });
      const { p2tr } = unlocked.addresses;

      const satsPerVbyte = await resolveFeeRate(fetch, mempoolApiBase(cfg), cli.feeRate);

      // Build the SDK params + a preview descriptor (mirrors buildSellOrderParams).
      let params: OpenSellOrderParams;
      let sellPreview: SellPreviewParams | null = null;
      let heading = "";

      if (type === "counterparty") {
        const asset = str(ctx.args.asset);
        const amount = str(ctx.args.amount);
        if (!asset) throw new CliError("--asset is required for counterparty", "MISSING_ASSET");
        if (!amount) throw new CliError("--amount is required for counterparty", "MISSING_AMOUNT");
        const owned = await findCounterpartyAsset(client, unlocked.addresses, asset);
        const quantity = toBaseUnits(amount, owned.divisible);
        if (quantity <= 0n) throw new CliError("--amount must be greater than 0", "BAD_AMOUNT");
        if (quantity > owned.balance) throw new CliError("--amount exceeds your balance", "INSUFFICIENT");
        params = {
          listingType: "counterparty",
          assetName: owned.assetName,
          assetQuantity: quantity,
          sellerAddress: owned.address,
          priceSats: price,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        sellPreview = {
          price,
          sellerAddress: owned.address,
          listingType: "counterparty",
          assetName: owned.assetName,
          assetQuantity: quantity,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        heading = `Sell ${amount} ${owned.assetName} for ${price} sats`;
      } else if (type === "zeld") {
        const amount = str(ctx.args.amount);
        if (!amount) throw new CliError("--amount is required for zeld", "MISSING_AMOUNT");
        const owned = await findZeldAsset(client, unlocked.addresses);
        const quantity = toBaseUnits(amount, true);
        if (quantity <= 0n) throw new CliError("--amount must be greater than 0", "BAD_AMOUNT");
        if (quantity > owned.balance) throw new CliError("--amount exceeds your balance", "INSUFFICIENT");
        params = {
          listingType: "zeld",
          assetName: "ZELD",
          assetQuantity: quantity,
          sellerAddress: owned.address,
          priceSats: price,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        sellPreview = {
          price,
          sellerAddress: owned.address,
          listingType: "zeld",
          assetName: "ZELD",
          assetQuantity: quantity,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        heading = `Sell ${amount} ZELD for ${price} sats`;
      } else if (type === "ordinal") {
        const utxo = str(ctx.args.utxo);
        const inscription = str(ctx.args.inscription);
        const assetUtxoId =
          utxo ??
          (inscription
            ? await resolveInscriptionUtxo(fetch, cfg.ordApiBaseUrl, inscription)
            : undefined);
        if (!assetUtxoId) {
          throw new CliError("Provide --utxo <txid:vout> or --inscription <id>", "MISSING_UTXO");
        }
        params = {
          listingType: "ordinal",
          assetUtxoId,
          sellerAddress: p2tr,
          priceSats: price,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        sellPreview = {
          price,
          sellerAddress: p2tr,
          listingType: "ordinal",
          assetUtxoId,
          autoSelectFeeUtxos: true,
          satsPerVbyte,
        };
        heading = `Sell inscription ${assetUtxoId} for ${price} sats`;
      } else if (type === "kor") {
        const amount = str(ctx.args.amount);
        if (!amount) throw new CliError("--amount is required for kor", "MISSING_AMOUNT");
        if (!/^\d+(\.\d+)?$/.test(amount.trim())) {
          throw new CliError("--amount must be a positive decimal number of KOR", "BAD_AMOUNT");
        }
        params = {
          listingType: "kontor",
          kontorAssetKind: "token",
          korAmount: amount,
          priceSats: price,
          satsPerVbyte,
        };
        heading = `Sell ${amount} KOR for ${price} sats`;
      } else {
        const nftId = str(ctx.args["nft-id"]);
        const nftContract = str(ctx.args["nft-contract"]) ?? cfg.kontorNftContractAddress;
        if (!nftId) throw new CliError("--nft-id is required for kontor-nft", "MISSING_NFT_ID");
        if (!nftContract) throw new CliError("--nft-contract is required for kontor-nft", "MISSING_NFT_CONTRACT");
        params = {
          listingType: "kontor",
          kontorAssetKind: "nft",
          nftId,
          nftContractAddress: nftContract,
          priceSats: price,
          satsPerVbyte,
        };
        heading = `Sell NFT ${nftId} for ${price} sats`;
      }

      const isKontor = type === "kor" || type === "kontor-nft";

      // Cost preview (side-effect-free) — PSBT quote for BTC-family, listing-fee
      // preview for Kontor (which also composes an on-chain attach reveal fee).
      let cost: SellCost | { listingFeeSats: number; feeWaived: boolean };
      if (isKontor) {
        const preview = await client.previewKontorListingFee(p2tr);
        cost = { listingFeeSats: preview.sats, feeWaived: preview.feeWaived };
      } else {
        cost = await previewSellCost(client, sellPreview!);
      }

      if (!cli.json) {
        const btcUsd = await fetchBtcUsd(fetch);
        if (isKontor) {
          const c = cost as { listingFeeSats: number; feeWaived: boolean };
          renderKontorSellReview(heading, c.listingFeeSats, c.feeWaived, btcUsd);
        } else {
          renderSellReview(heading, cost as SellCost, btcUsd);
        }
      }
      await confirmAction(cli, "List this sell order?");

      const { swap, created, transactions } = await client.openSellOrder(params, {
        onProgress: makeProgress(cli),
      });

      // `transactions` are the on-chain txs the listing broadcast — an `asset` tx
      // (counterparty attach/reveal, zeld transfer, Kontor attach reveal) and/or a
      // standalone `fee` payment. Empty when it reused an existing UTXO with the fee
      // waived by a credit: nothing hit the chain, so there's no tx to link.
      const links = transactions.flatMap((t) => {
        const url = mempoolTxUrl(cfg, t.txid);
        return url ? [{ kind: t.kind, url }] : [];
      });

      return {
        json: { swap, created, cost, transactions: links },
        human: () => {
          console.log(pc.green(`\n✔ Listed ${created ? "(new)" : "(existing)"} — swap ${swap.id}`));
          for (const link of links) {
            const label = links.length > 1 ? `${link.kind.padEnd(5)} ` : "";
            console.log(pc.dim(`  ${label}${link.url}`));
          }
        },
      };
    });
  },
});
