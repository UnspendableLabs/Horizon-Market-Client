import { defineCommand } from "citty";
import pc from "picocolors";
import Table from "cli-table3";
import type {
  CounterpartyBalance,
  KontorHoldings,
  ZeldBalance,
} from "@unspendablelabs/horizon-market-client";
import { globalArgs } from "../context.js";
import { note, runCommand } from "../lib/output.js";
import { getNetworkConfig, mempoolApiBase } from "../lib/networks.js";
import { requireKeystore } from "../lib/keystore.js";
import { unlockWallet, walletAddresses } from "../lib/wallet.js";
import { createClient } from "../lib/client.js";
import { fetchBtcBalanceSats } from "../lib/btc-balance.js";
import { fetchBtcUsd } from "../lib/prices.js";
import { fetchInscriptionUtxos, type OrdinalUtxo } from "../lib/ordinals.js";
import { resolvePassword } from "../lib/prompt.js";
import { formatAssetQuantity, formatUsd, satsToBtc, truncate } from "../lib/format.js";

function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export const balancesCommand = defineCommand({
  meta: {
    name: "balances",
    description: "Show wallet balances (read-only; BTC / Counterparty / ZELD / ordinals)",
  },
  args: {
    ...globalArgs,
    "include-kontor": {
      type: "boolean",
      description: "Also read Kontor (KOR + NFTs) — requires unlocking the keystore (signet)",
      default: false,
    },
  },
  run: async (ctx) => {
    await runCommand(ctx.args as Record<string, unknown>, async (cli) => {
      const stored = requireKeystore(cli.homeDir);
      const uiNetwork = cli.networkOverride ?? stored.network;
      const cfg = getNetworkConfig(uiNetwork);
      const addrs = walletAddresses(stored, cfg.sdkNetwork);
      const addressList = [addrs.p2wpkh, addrs.p2tr];

      // Kontor read needs the signer — unlock only when explicitly requested.
      let kontor: KontorHoldings | null = null;
      if (ctx.args["include-kontor"]) {
        if (cfg.kontorNetwork !== "signet") {
          note(cli, "Kontor is signet-only — skipping (pass --network signet).");
        } else {
          const password = await resolvePassword(cli);
          const unlocked = await unlockWallet(stored, password, cfg.sdkNetwork, cli.passphrase);
          const signedClient = createClient(cfg, {
            mnemonic: unlocked.mnemonic,
            mnemonicOptions: unlocked.mnemonicOptions,
          });
          kontor = await signedClient.getKontorHoldings();
        }
      }

      const readClient = createClient(cfg);
      const [btcR, usdR, cpR, zeldR, ordR] = await Promise.allSettled([
        fetchBtcBalanceSats(fetch, mempoolApiBase(cfg), addressList),
        fetchBtcUsd(fetch),
        readClient.getCounterpartyBalances(addressList),
        readClient.getZeldBalances(addressList),
        fetchInscriptionUtxos(fetch, cfg.ordApiBaseUrl, addressList),
      ]);

      const btcSats = btcR.status === "fulfilled" ? btcR.value : null;
      const btcUsd = settled(usdR, null);
      const counterparty = settled<CounterpartyBalance[]>(cpR, []);
      const zeld = settled<ZeldBalance[]>(zeldR, []);
      const ordinals = settled<OrdinalUtxo[]>(ordR, []);

      return {
        json: {
          network: cfg.uiNetwork,
          addresses: addrs,
          btc: { sats: btcSats, usd: btcUsd != null && btcSats != null ? formatUsd(Number(btcSats), btcUsd) : null },
          counterparty,
          zeld,
          ordinals,
          kontor,
        },
        human: () => {
          console.log(pc.bold(`\nWallet on ${cfg.label}`));

          const makeTable = (head: string[]) =>
            new Table({
              head: head.map((h) => pc.dim(h)),
              style: { head: [], border: [] },
            });

          console.log(pc.bold("\nAddresses"));
          const addrTable = makeTable(["Type", "Address"]);
          addrTable.push(["Segwit (p2wpkh)", addrs.p2wpkh]);
          addrTable.push(["Taproot (p2tr)", addrs.p2tr]);
          console.log(addrTable.toString());

          // Headline balances — BTC / XCP / KOR / ZELD, always shown ("0" when
          // none), mirroring the wallet page's four featured tokens.
          const usd = btcSats != null ? formatUsd(Number(btcSats), btcUsd) : null;
          const btcCell =
            btcSats == null
              ? pc.dim("unavailable")
              : `${satsToBtc(btcSats)}${usd ? pc.dim(`  (${usd})`) : ""}`;

          // XCP / ZELD are divisible: sum the (possibly multi-address) base-unit
          // holdings and normalize, matching `useWalletTokenSummary`.
          const xcp = counterparty.filter((b) => b.asset === "XCP");
          const xcpAmount = xcp.length
            ? formatAssetQuantity(xcp.reduce((t, b) => t + b.quantity, 0n), true)
            : "0";
          const zeldAmount = zeld.length
            ? formatAssetQuantity(zeld.reduce((t, b) => t + b.balance, 0n), true)
            : "0";
          // KOR needs an unlock (--include-kontor); "—" + a footnote when unread.
          const korAmount = kontor ? (kontor.kor?.amount ?? "0") : null;

          console.log(pc.bold("Balances"));
          const balances = makeTable(["Asset", "Balance"]);
          balances.push(["BTC", btcCell]);
          balances.push(["XCP", xcpAmount]);
          balances.push(["KOR", korAmount ?? pc.dim("—")]);
          balances.push(["ZELD", zeldAmount]);
          console.log(balances.toString());
          if (!kontor) {
            console.log(
              pc.dim("  KOR + Kontor NFTs not read — pass --include-kontor (signet)."),
            );
          }

          // Counterparty holdings (everything but the XCP headline above).
          const cpOthers = counterparty.filter((b) => b.asset !== "XCP");
          if (cpOthers.length) {
            console.log(pc.bold("\nCounterparty"));
            const t = makeTable(["Asset", "Balance", "Address"]);
            for (const b of cpOthers) {
              t.push([b.asset, b.quantityNormalized, truncate(b.address, 6, 4)]);
            }
            console.log(t.toString());
          }

          if (ordinals.length) {
            console.log(pc.bold(`\nOrdinals (${ordinals.length})`));
            const t = makeTable(["Inscription", "UTXO"]);
            for (const o of ordinals) {
              const label =
                o.inscriptionNumber != null
                  ? `#${o.inscriptionNumber.toLocaleString("en-US")}`
                  : truncate(o.inscriptionId, 10, 6);
              t.push([label, truncate(o.utxoId, 8, 6)]);
            }
            console.log(t.toString());
          }

          if (kontor && kontor.nfts.length) {
            console.log(pc.bold(`\nKontor NFTs (${kontor.nfts.length})`));
            const t = makeTable(["NFT", "Contract"]);
            for (const n of kontor.nfts) {
              t.push([truncate(n.nftId, 10, 6), n.contractAddress]);
            }
            console.log(t.toString());
          }
        },
      };
    });
  },
});
