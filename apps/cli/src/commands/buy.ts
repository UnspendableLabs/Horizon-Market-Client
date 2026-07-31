import { defineCommand } from "citty";
import pc from "picocolors";
import { globalArgs } from "../context.js";
import { CliError, note, runCommand } from "../lib/output.js";
import { getNetworkConfig, mempoolApiBase, mempoolTxUrl } from "../lib/networks.js";
import { requireKeystore } from "../lib/keystore.js";
import { unlockWallet } from "../lib/wallet.js";
import { createClient } from "../lib/client.js";
import { fetchBtcUsd } from "../lib/prices.js";
import {
  confirmAction,
  makeProgress,
  requireScriptableWrite,
  resolvePassword,
} from "../lib/prompt.js";
import { previewBuyCost, renderBuyReview, resolveFeeRate } from "../lib/review.js";

export const buyCommand = defineCommand({
  meta: {
    name: "buy",
    description: "Fill (purchase) a swap listing (unlocks the keystore)",
  },
  args: {
    ...globalArgs,
    order: { type: "string", required: true, description: "Swap id to buy" },
    taproot: { type: "string", description: "P2TR receive address (default: your keystore taproot)" },
    "no-detach": { type: "boolean", description: "Do not detach the asset (counterparty)", default: false },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      requireScriptableWrite(cli);
      const orderId = String(ctx.args.order);
      if (!orderId) throw new CliError("--order <swapId> is required", "MISSING_ORDER");

      const stored = requireKeystore(cli.homeDir);
      const cfg = getNetworkConfig(cli.networkOverride ?? stored.network);

      const password = await resolvePassword(cli);
      const unlocked = await unlockWallet(stored, password, cfg.sdkNetwork, cli.passphrase);
      const client = createClient(cfg, {
        mnemonic: unlocked.mnemonic,
        mnemonicOptions: unlocked.mnemonicOptions,
      });
      const buyerAddress = unlocked.addresses.p2wpkh;
      const buyerTaproot =
        typeof ctx.args.taproot === "string" && ctx.args.taproot
          ? ctx.args.taproot
          : unlocked.addresses.p2tr;
      const detach = !ctx.args["no-detach"];

      const swap = await client.getSwap(orderId);
      const satsPerVbyte = await resolveFeeRate(fetch, mempoolApiBase(cfg), cli.feeRate);

      const cost = await previewBuyCost(client, swap, {
        buyerAddress,
        buyerTaprootAddress: buyerTaproot,
        detach,
        satsPerVbyte,
      });

      if (!cli.json) {
        const btcUsd = await fetchBtcUsd(fetch);
        renderBuyReview(`Buy ${swap.listingType} swap ${swap.id}`, cost, btcUsd);
      }

      // Ask the chain *before* asking the user. `fillSwaps` runs this same check
      // and refuses to broadcast when it fails — running it here too means an
      // unbacked listing, or a wallet that can't pay Kontor gas, is turned away
      // without ever prompting for a purchase that was never going to deliver.
      if (swap.listingType === "kontor") {
        const verdict = await client.preflightKontorPurchase(swap);
        if (verdict.error) throw verdict.error;
        note(
          cli,
          `Kontor gas ≈ ${verdict.requiredKor} KOR (account holds ${verdict.balanceKor} KOR)`,
        );
      }

      await confirmAction(cli, "Confirm this purchase?");

      const sales = await client.fillSwaps(
        { swapIds: [orderId], buyerAddress, buyerTaprootAddress: buyerTaproot, satsPerVbyte, detach },
        { onProgress: makeProgress(cli) },
      );
      const txId = sales[0]?.txId ?? null;
      const explorer = mempoolTxUrl(cfg, txId);

      return {
        json: { order: orderId, pay: cost, result: { txId }, explorer },
        human: () => {
          console.log(pc.green(`\n✔ Purchase submitted — tx ${txId ?? "(pending)"}`));
          if (explorer) console.log(pc.dim(`  ${explorer}`));
        },
      };
    });
  },
});
