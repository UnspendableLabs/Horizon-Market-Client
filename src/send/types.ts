import type * as btc from "bitcoinjs-lib";
import type { Signer } from "../crypto/signer.js";
import type { HttpClient } from "../api/http.js";
import type { KontorContext } from "../kontor/context.js";

/** Bitcoin network the send targets (signet shares testnet params). */
export type SendNetwork = "mainnet" | "testnet";

/**
 * A unified send/withdraw request across every supported asset type.
 *
 * Fungible amounts are always base units: `amountSats`/`quantity`/`amount` are
 * pre-scaled by the caller (divisible → ×1e8, indivisible → integer count). KOR
 * uses a decimal string (18 decimals, scaled by the SDK's `Decimal`). Ordinals
 * and NFTs are 1-of-1, so they carry no amount.
 *
 * `fromAddress` is the holding address of the asset (P2WPKH or P2TR) — the send
 * spends from it. BTC omits it: the composer funds from the signer's own
 * P2WPKH + P2TR addresses. Kontor uses `toAddress` as a P2TR address from which
 * the recipient holder ref is derived.
 */
export type SendRequest =
  | {
      kind: "btc";
      toAddress: string;
      amountSats: bigint;
      satsPerVbyte: number;
    }
  | {
      kind: "counterparty";
      fromAddress: string;
      asset: string;
      toAddress: string;
      /** Base units: divisible → sats (×1e8), indivisible → whole count. */
      quantity: bigint;
      divisible: boolean;
      satsPerVbyte: number;
    }
  | {
      kind: "zeld";
      fromAddress: string;
      toAddress: string;
      /** ZELD base units (8 decimals). */
      amount: bigint;
      satsPerVbyte: number;
    }
  | {
      kind: "ordinal";
      fromAddress: string;
      /** Inscription holding UTXO id (`txid:vout`). */
      utxoId: string;
      toAddress: string;
      satsPerVbyte: number;
    }
  | {
      kind: "kor";
      /** Recipient P2TR address; the holder ref is derived from it. */
      toAddress: string;
      /** KOR amount as a decimal string (e.g. "100.5"). */
      amount: string;
      satsPerVbyte?: number;
    }
  | {
      kind: "kontor-nft";
      contractAddress: string;
      nftId: string;
      /** Recipient P2TR address; the holder ref is derived from it. */
      toAddress: string;
      satsPerVbyte?: number;
    };

/** The kind discriminant of a {@link SendRequest}. */
export type SendKind = SendRequest["kind"];

/** Result of a completed send — the broadcast transaction id. */
export interface SendResult {
  txid: string;
}

/**
 * A composed-and-signed send, ready to broadcast — the review-step handle that
 * lets the UI show the *exact* miner fee before committing. `prepareSend`
 * composes, funds and signs the transaction (no network write); calling
 * {@link PreparedSend.broadcast} publishes it.
 *
 * `feeSats` is the exact miner fee for the Bitcoin-family sends (btc, ordinal,
 * zeld, counterparty), computed as `Σ inputs − Σ outputs`. It is `null` for
 * Kontor sends, whose fee is set by the `@kontor/sdk` at submit time — those
 * cannot be pre-composed, so `broadcast()` performs the whole submit.
 */
export interface PreparedSend {
  kind: SendKind;
  /** Exact miner fee in sats, or `null` when set externally (Kontor). */
  feeSats: bigint | null;
  /** Publish the prepared transaction; resolves to the broadcast txid. */
  broadcast(): Promise<SendResult>;
}

/**
 * Runtime dependencies for the send composers, assembled by the client from its
 * own configuration. Carries no plaintext key material — signing happens inside
 * the `signer` / Kontor SDK.
 */
export interface SendDeps {
  signer: Signer;
  fetch: typeof globalThis.fetch;
  network: SendNetwork;
  btcNetwork: btc.Network;
  kontorNetwork?: "signet";
  /** Horizon HTTP client — used only to auto-fetch Kontor funding UTXOs. */
  http: HttpClient;
  /** Counterparty API v2 base URL (required for `counterparty` sends). */
  counterpartyApiBaseUrl?: string;
  /** ZeldHash API base URL (required for `zeld` sends). */
  zeldApiBaseUrl?: string;
  /** Resolved Kontor runtime context (required for `kor` / `kontor-nft` sends). */
  kontorCtx?: KontorContext;
  /**
   * UTXO ids (`txid:vout`) that must never be spent as plain BTC / fee funding —
   * inscription outputs and other asset-bearing UTXOs. Best-effort asset-safety.
   */
  protectedUtxoIds?: readonly string[];
}
