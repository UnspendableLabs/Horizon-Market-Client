import * as btc from "bitcoinjs-lib";
import { inMemoryFunding, queryFunding } from "@kontor/sdk";
import type { Utxo } from "@kontor/sdk";
import type { HttpClient } from "../api/http.js";
import type { KontorFunding, KontorUtxoInput } from "../types/index.js";

const MAX_FUNDING_UTXOS = 10;

/** Esplora/electrs UTXO shape returned by Horizon's `/api/bitcoin/address/{addr}/utxos`. */
interface WireUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

/** Derive the P2TR scriptPubKey hex for a taproot address. */
export function taprootScriptPubKeyHex(
  address: string,
  network: btc.Network,
): string {
  const script = btc.address.toOutputScript(address, network);
  return Buffer.from(script).toString("hex");
}

function toSdkUtxo(u: KontorUtxoInput, fallbackScriptPubKey: string): Utxo {
  return {
    txid: u.txid,
    vout: u.vout,
    value: BigInt(u.value),
    scriptPubKey: u.scriptPubKey ?? fallbackScriptPubKey,
  };
}

/**
 * Fetch and map the confirmed taproot UTXOs for `address` from Horizon's public
 * proxy. Sends only the address (public) — never a key. Exported for testing.
 */
export async function fetchKontorFundingUtxos(
  http: HttpClient,
  address: string,
  network: btc.Network,
): Promise<Utxo[]> {
  const scriptPubKey = taprootScriptPubKeyHex(address, network);
  const utxos = await http.request<WireUtxo[]>(
    "GET",
    `/api/bitcoin/address/${address}/utxos`,
  );
  return utxos
    .filter((u) => u.status.confirmed)
    .slice(0, MAX_FUNDING_UTXOS)
    .map((u) =>
      toSdkUtxo({ txid: u.txid, vout: u.vout, value: u.value }, scriptPubKey),
    );
}

/**
 * Resolve a Kontor SDK funding source for `address`.
 *
 * - explicit array   → in-memory pool (scriptPubKey derived from `address` if omitted)
 * - explicit fetcher → re-queried on every on-chain submit
 * - undefined        → auto-fetch confirmed UTXOs from Horizon's public proxy
 *
 * SECURITY: auto-fetch sends only the taproot ADDRESS (public). No private key is
 * ever involved here — signing happens later, locally, inside the Kontor SDK.
 */
export function resolveKontorFunding(
  http: HttpClient,
  address: string,
  network: btc.Network,
  funding: KontorFunding | undefined,
): ReturnType<typeof inMemoryFunding> | ReturnType<typeof queryFunding> {
  const scriptPubKey = taprootScriptPubKeyHex(address, network);

  if (Array.isArray(funding)) {
    return inMemoryFunding(funding.map((u) => toSdkUtxo(u, scriptPubKey)));
  }

  if (typeof funding === "function") {
    return queryFunding(async () =>
      (await funding()).map((u) => toSdkUtxo(u, scriptPubKey)),
    );
  }

  // Auto-fetch confirmed UTXOs for the taproot address on each submit.
  return queryFunding(() => fetchKontorFundingUtxos(http, address, network));
}
