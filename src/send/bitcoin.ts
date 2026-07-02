import * as btc from "bitcoinjs-lib";
import type { SendNetwork } from "./types.js";

/**
 * Shared Bitcoin layer for the send composers: UTXO / prev-tx reads and raw-tx
 * broadcast against mempool.space, PSBT input construction, and vsize/fee
 * estimation. Every value is satoshis as `bigint` (bitcoinjs-lib v7).
 */

/**
 * mempool.space REST API base for the active network (no trailing slash).
 * Mirrors `react/internal/format.ts#mempoolApiBase`, duplicated here so the
 * core send lib carries no dependency on the React entry.
 */
export function mempoolApiBase(
  network: SendNetwork,
  kontorNetwork: "signet" | undefined,
): string {
  if (network === "mainnet") return "https://mempool.space/api";
  return kontorNetwork === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/testnet/api";
}

/** A spendable UTXO as read from mempool.space (value in sats). */
export interface SpendableUtxo {
  txid: string;
  vout: number;
  value: bigint;
}

interface WireUtxo {
  txid?: unknown;
  vout?: unknown;
  value?: unknown;
  status?: { confirmed?: unknown } | null;
}

function toSats(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isFinite(value))
    return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return BigInt(value.trim());
  return null;
}

/**
 * Fetch confirmed UTXOs for `address` from mempool.space, excluding any id in
 * `protectedIds` (`txid:vout` — inscriptions / asset-bearing outputs). Sorted
 * largest-first for greedy selection.
 */
export async function fetchConfirmedUtxos(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  address: string,
  protectedIds?: ReadonlySet<string>,
): Promise<SpendableUtxo[]> {
  const res = await fetchImpl(
    `${base}/address/${encodeURIComponent(address)}/utxo`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`mempool utxo returned ${res.status}: ${res.statusText}`);
  }
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) return [];
  const out: SpendableUtxo[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as WireUtxo;
    if (row.status?.confirmed !== true) continue;
    const txid = typeof row.txid === "string" ? row.txid : null;
    const vout = typeof row.vout === "number" ? row.vout : null;
    const value = toSats(row.value);
    if (txid === null || vout === null || value === null || value <= 0n) continue;
    if (protectedIds?.has(`${txid}:${vout}`)) continue;
    out.push({ txid, vout, value });
  }
  return out.sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
}

/** A single output of a previous transaction (for building a witnessUtxo). */
export interface PrevOutput {
  value: bigint;
  scriptPubKeyHex: string;
}

interface WireTxVout {
  value?: unknown;
  scriptpubkey?: unknown;
}

/** Read one output (`txid:vout`) of a prior tx from mempool.space. */
export async function fetchPrevOutput(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  txid: string,
  vout: number,
): Promise<PrevOutput> {
  const res = await fetchImpl(`${base}/tx/${encodeURIComponent(txid)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`mempool tx returned ${res.status}: ${res.statusText}`);
  }
  const body = (await res.json()) as { vout?: unknown };
  const outs = Array.isArray(body.vout) ? (body.vout as WireTxVout[]) : [];
  const out = outs[vout];
  const value = out ? toSats(out.value) : null;
  const script = out && typeof out.scriptpubkey === "string" ? out.scriptpubkey : null;
  if (value === null || script === null) {
    throw new Error(`prev output ${txid}:${vout} not found`);
  }
  return { value, scriptPubKeyHex: script };
}

/** Fetch the full raw tx hex (for a legacy `nonWitnessUtxo` input). */
export async function fetchRawTxHex(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  txid: string,
): Promise<string> {
  const res = await fetchImpl(`${base}/tx/${encodeURIComponent(txid)}/hex`, {
    headers: { Accept: "text/plain" },
  });
  if (!res.ok) {
    throw new Error(`mempool tx hex returned ${res.status}: ${res.statusText}`);
  }
  return (await res.text()).trim();
}

/** Broadcast a finalized raw tx hex; resolves to the broadcast txid. */
export async function broadcastRawTx(
  fetchImpl: typeof globalThis.fetch,
  base: string,
  rawTxHex: string,
): Promise<string> {
  const res = await fetchImpl(`${base}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawTxHex,
  });
  const text = (await res.text()).trim();
  if (!res.ok) {
    throw new Error(`Broadcast failed (${res.status}): ${text || res.statusText}`);
  }
  return text;
}

/** A P2WPKH/P2TR PSBT input built from a prev output. */
export interface WitnessInput {
  hash: string;
  index: number;
  witnessUtxo: { script: Uint8Array; value: bigint };
}

/** Build a segwit/taproot PSBT input from an outpoint + its prev output. */
export function witnessInput(
  txid: string,
  vout: number,
  prev: PrevOutput,
): WitnessInput {
  return {
    hash: txid,
    index: vout,
    witnessUtxo: {
      script: Buffer.from(prev.scriptPubKeyHex, "hex"),
      value: prev.value,
    },
  };
}

/**
 * Per-input vsize (vB) for an address's script type. Rounded up so the fee
 * never *under*pays for non-segwit inputs. Ported from Horizon Market's
 * `compose-transfer-server.ts#inputVSizeForAddress`.
 */
export function inputVsizeForAddress(
  address: string,
  network: btc.Network,
): number {
  let script: Uint8Array;
  try {
    script = btc.address.toOutputScript(address, network);
  } catch {
    return 68; // unknown shape: keep a P2WPKH-ish estimate
  }
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return 58; // P2TR
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return 68; // P2WPKH
  if (script.length === 34 && script[0] === 0x00 && script[1] === 0x20) return 105; // P2WSH
  if (script.length === 23 && script[0] === 0xa9 && script[22] === 0x87) return 91; // P2SH
  return 148; // P2PKH legacy
}

/** Serialized vsize (vB) of an output paying `address`. */
export function outputVsizeForAddress(
  address: string,
  network: btc.Network,
): number {
  let len: number;
  try {
    len = btc.address.toOutputScript(address, network).length;
  } catch {
    len = 34; // conservative (P2TR/P2WSH sized)
  }
  return outputVsizeForScriptLen(len);
}

/** Serialized vsize (vB) of an output with a script of `scriptLen` bytes. */
export function outputVsizeForScriptLen(scriptLen: number): number {
  // 8 (value) + varint(scriptLen) + scriptLen. scriptLen < 253 → 1-byte varint.
  return 8 + 1 + scriptLen;
}

/** Fixed per-tx overhead (version, locktime, segwit marker/flag, counts). */
export const TX_OVERHEAD_VSIZE = 11;

/** Dust threshold (sats) below which a plain BTC change output is dropped. */
export const BTC_DUST_SATS = 546n;

/** Estimate the fee (sats) for a tx given its total vsize and rate. */
export function feeForVsize(vsize: number, satsPerVbyte: number): bigint {
  return BigInt(Math.ceil(vsize * satsPerVbyte));
}
