import { defineCommand } from "citty";
import pc from "picocolors";
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
import { formatUsd, kv, satsToBtc } from "../lib/format.js";

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
          console.log(pc.bold(`\nBalances on ${cfg.label}`));
          const btcLine = btcSats == null ? pc.dim("unavailable") : `${satsToBtc(btcSats)} BTC`;
          const usd = btcSats != null ? formatUsd(Number(btcSats), btcUsd) : null;
          console.log(kv("BTC", `${btcLine}${usd ? pc.dim(`  (${usd})`) : ""}`));

          if (counterparty.length) {
            console.log(pc.bold("\nCounterparty"));
            for (const b of counterparty) console.log(kv(b.asset, b.quantityNormalized));
          }
          if (zeld.length) {
            console.log(pc.bold("\nZELD"));
            for (const b of zeld) console.log(kv("ZELD", b.quantityNormalized));
          }
          if (kontor && (kontor.kor || kontor.nfts.length)) {
            console.log(pc.bold("\nKontor"));
            if (kontor.kor) console.log(kv("KOR", kontor.kor.amount));
            for (const n of kontor.nfts) console.log(kv("NFT", n.nftId));
          }
          if (ordinals.length) {
            console.log(pc.bold(`\nOrdinals (${ordinals.length})`));
            for (const o of ordinals) console.log(kv(o.utxoId, o.inscriptionId));
          }

          console.log(pc.bold("\nAddresses"));
          console.log(kv("Segwit (p2wpkh)", addrs.p2wpkh));
          console.log(kv("Taproot (p2tr)", addrs.p2tr));
        },
      };
    });
  },
});
