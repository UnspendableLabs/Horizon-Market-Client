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

/** The failure behind an empty list, or null when the read actually succeeded. */
export function failure(r: PromiseSettledResult<unknown>): string | null {
  if (r.status === "fulfilled") return null;
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

/** Why a Kontor read came back empty without reaching the chain (SDK wording). */
const KONTOR_UNAVAILABLE: Record<
  NonNullable<KontorHoldings["unavailable"]>,
  string
> = {
  runtime: "no Kontor backend could load here",
  network: "Kontor is signet-only and this client targets another network",
  "wallet-key": "this wallet exposes no Taproot public key",
};

/**
 * Why the Kontor read produced nothing, or null when it succeeded / was never
 * asked for (no `--include-kontor`, which the table footnotes separately).
 * `getKontorHoldings` resolves rather than rejects when it can't read at all,
 * so its failures arrive as a tag on the result, not as a rejection.
 */
export function kontorFailure(kontor: KontorHoldings | null): string | null {
  return kontor?.unavailable ? KONTOR_UNAVAILABLE[kontor.unavailable] : null;
}

/** Every independently-readable source behind the output. */
export interface BalanceErrors {
  btc: string | null;
  price: string | null;
  counterparty: string | null;
  zeld: string | null;
  ordinals: string | null;
  kontor: string | null;
}

/**
 * How each source is named in the failure footnotes. The raw object keys would
 * do, but "counterparty"/"price" read as jargon next to a table of BTC / XCP /
 * KOR / ZELD rows.
 */
export const SOURCE_LABEL: Record<keyof BalanceErrors, string> = {
  btc: "BTC balance",
  price: "BTC price",
  counterparty: "Counterparty",
  zeld: "ZELD",
  ordinals: "Ordinals",
  kontor: "Kontor",
};

/**
 * A headline amount, or null when its source failed — "—" is printed for null.
 * Never "0": that source yields an empty list either way, and "0" is a
 * confident claim about a balance we could not read.
 */
export function headlineAmount<T>(
  error: string | null,
  values: T[],
  compute: (values: T[]) => string,
): string | null {
  if (error) return null;
  return values.length ? compute(values) : "0";
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

      // A failed read yields the same empty list as an empty wallet, so keep the
      // reason: printing "0" for a source that never answered claims a balance
      // we could not read.
      const errors: BalanceErrors = {
        btc: failure(btcR),
        // The USD conversion is its own read: without it the BTC row silently
        // drops its "(…)" suffix, which looks like "we have no price for you"
        // rather than "the price feed is down".
        price: failure(usdR),
        counterparty: failure(cpR),
        zeld: failure(zeldR),
        ordinals: failure(ordR),
        kontor: kontorFailure(kontor),
      };

      return {
        json: {
          network: cfg.uiNetwork,
          addresses: addrs,
          // Raw number (not the locale currency string the human table shows) —
          // machine output should not need de-formatting.
          btc: {
            sats: btcSats,
            usd:
              btcUsd != null && btcSats != null
                ? Math.round((Number(btcSats) / 1e8) * btcUsd * 100) / 100
                : null,
          },
          counterparty,
          zeld,
          ordinals,
          kontor,
          // Null per source on success; a message when that source's list is
          // empty because the read failed, not because the wallet holds none.
          errors,
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
          // none, "—" when the read failed), mirroring the wallet page's four
          // featured tokens.
          const usd = btcSats != null ? formatUsd(Number(btcSats), btcUsd) : null;
          const btcCell =
            btcSats == null
              ? pc.dim("unavailable")
              : `${satsToBtc(btcSats)}${usd ? pc.dim(`  (${usd})`) : ""}`;

          // XCP / ZELD are divisible: sum the (possibly multi-address) base-unit
          // holdings and normalize, matching `useWalletTokenSummary`.
          const xcp = counterparty.filter((b) => b.asset === "XCP");
          const xcpAmount = headlineAmount(errors.counterparty, xcp, (bs) =>
            formatAssetQuantity(bs.reduce((t, b) => t + b.quantity, 0n), true),
          );
          const zeldAmount = headlineAmount(errors.zeld, zeld, (bs) =>
            formatAssetQuantity(bs.reduce((t, b) => t + b.balance, 0n), true),
          );
          // KOR needs an unlock (--include-kontor); "—" + a footnote when unread
          // — and the same when the read ran but never reached the chain.
          const korAmount =
            kontor && !errors.kontor ? (kontor.kor?.amount ?? "0") : null;

          console.log(pc.bold("Balances"));
          const balances = makeTable(["Asset", "Balance"]);
          balances.push(["BTC", btcCell]);
          balances.push(["XCP", xcpAmount ?? pc.dim("—")]);
          balances.push(["KOR", korAmount ?? pc.dim("—")]);
          balances.push(["ZELD", zeldAmount ?? pc.dim("—")]);
          console.log(balances.toString());
          if (!kontor) {
            console.log(
              pc.dim("  KOR + Kontor NFTs not read — pass --include-kontor (signet)."),
            );
          }
          // Name every failed source behind THIS table: a "—" the user can't
          // explain is barely better than the "0" it replaces. Ordinals has no
          // headline row, so its failure is reported with its own section below.
          const footnote = (source: keyof BalanceErrors) => {
            const message = errors[source];
            if (message) {
              console.log(
                pc.dim(`  ${SOURCE_LABEL[source]} unavailable — ${message}`),
              );
            }
          };
          footnote("btc");
          footnote("price");
          footnote("counterparty");
          footnote("kontor");
          footnote("zeld");

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

          // An ord API that didn't answer prints nothing at all otherwise — the
          // same silence as a wallet holding no inscriptions.
          if (errors.ordinals) {
            console.log(pc.bold("\nOrdinals"));
            console.log(pc.dim(`  unavailable — ${errors.ordinals}`));
          } else if (ordinals.length) {
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
