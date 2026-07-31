import type { KontorSession } from "@kontor/sdk";
import { HolderRef } from "@kontor/sdk";
import { Decimal, bindKontorNft, bindKontorToken } from "./contracts.js";
import {
  korCostForGas,
  detachGasLimitFromBlob,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_ATTACH_GAS_LIMIT,
} from "./gas.js";
import type { KontorAssetKind } from "../types/index.js";

/**
 * Pre-flight checks for Kontor listings and purchases.
 *
 * Every Kontor contract call is gas-metered: the node holds
 * `gas_limit × gas_to_token_multiplier` KOR from the op's payer *before*
 * dispatching the call, and rejects the op when the payer cannot cover it.
 * That rejection happens ahead of execution, so the node writes **no result
 * row** — the op leaves no trace in `/results` or in
 * `GET /transactions/{txid}/inspect`, and the SDK's poller (which synthesises
 * its events from result rows) never sees it either.
 *
 * The Bitcoin side of a swap settles regardless: the seller's attach reveal
 * still creates its 600-sat "escrow" output, and the buyer's swap reveal still
 * pays the seller. So an unfunded payer produces a listing whose asset was
 * never escrowed, or a purchase where the buyer pays and receives nothing —
 * silently, with every API surface reporting success.
 *
 * Nothing after the fact can detect this cheaply, so we gate *before*
 * broadcasting: check that the gas payer holds KOR, and that the asset is
 * where the flow assumes it is. All checks are `view` calls — no signature, no
 * transaction, no fee.
 */

/**
 * Gas limits, gas→KOR pricing and the offer-blob gas reader live in `./gas.ts`
 * — pure arithmetic with no `@kontor/sdk` import, so the React layer can size a
 * "Max" button from them without pulling the Kontor WASM backend in. Re-exported
 * here because they are part of this module's public story.
 */
export {
  korCostForGas,
  detachGasLimitFromBlob,
  maxListableKor,
  subtractKor,
  KONTOR_ATTACH_GAS_LIMIT,
  KONTOR_ACCEPT_GAS_LIMIT,
  KONTOR_DETACH_GAS_LIMIT,
} from "./gas.js";

/** Which flow a gas shortfall was detected in — drives the error wording. */
export type KontorGasOperation = "listing" | "purchase" | "delist";

/**
 * The connected wallet cannot pay the Kontor gas its next op commits to.
 *
 * Thrown *before* anything is signed or broadcast, so nothing is lost — the
 * user needs KOR in their Kontor account (on signet: the faucet) and can retry.
 */
export class KontorInsufficientGasError extends Error {
  /** `"listing"`, `"purchase"` or `"delist"` — which flow was gated. */
  readonly operation: KontorGasOperation;
  /** KOR the op's gas limit costs, decimal string. */
  readonly requiredKor: string;
  /** KOR the payer actually holds, decimal string. */
  readonly availableKor: string;
  /** Gas limit the op commits to. */
  readonly gasLimit: number;
  /** Payer's registered Kontor signer-id, or null when never registered. */
  readonly signerId: number | null;
  /** Payer's x-only pubkey (the Kontor identity that pays). */
  readonly xOnlyPubkey: string;

  constructor(args: {
    operation: KontorGasOperation;
    requiredKor: string;
    availableKor: string;
    gasLimit: number;
    signerId: number | null;
    xOnlyPubkey: string;
  }) {
    const what =
      args.operation === "listing"
        ? "Listing an asset on Kontor"
        : args.operation === "purchase"
          ? "Buying a Kontor listing"
          : "Delisting a Kontor listing (reclaiming the escrowed asset)";
    super(
      `Not enough KOR to pay Kontor network gas. ${what} costs about ` +
        `${args.requiredKor} KOR in gas, and this wallet's Kontor account holds ` +
        `${args.availableKor} KOR. Fund it with KOR (on signet, use the faucet) ` +
        `and try again — nothing was broadcast or paid.`,
    );
    this.name = "KontorInsufficientGasError";
    this.operation = args.operation;
    this.requiredKor = args.requiredKor;
    this.availableKor = args.availableKor;
    this.gasLimit = args.gasLimit;
    this.signerId = args.signerId;
    this.xOnlyPubkey = args.xOnlyPubkey;
  }
}

/** The wallet does not hold the asset it is trying to list. */
export class KontorAssetUnavailableError extends Error {
  readonly assetKind: KontorAssetKind;
  /** NFT id, or the KOR amount requested, depending on `assetKind`. */
  readonly asset: string;
  /** KOR the wallet holds — only set for `assetKind: "token"`. */
  readonly availableKor?: string;

  constructor(args: {
    assetKind: KontorAssetKind;
    asset: string;
    availableKor?: string;
    detail: string;
  }) {
    super(`Cannot list this Kontor asset: ${args.detail}`);
    this.name = "KontorAssetUnavailableError";
    this.assetKind = args.assetKind;
    this.asset = args.asset;
    if (args.availableKor !== undefined) this.availableKor = args.availableKor;
  }
}

/**
 * The listing's escrow UTXO does not actually hold the advertised asset.
 *
 * The seller's `attach` op never took effect (most often: the seller could not
 * pay its gas), so the listing is backed by nothing. Buying it would pay the
 * seller for an asset that cannot be delivered — this is thrown before
 * `accept()` broadcasts, so the buyer pays nothing.
 */
export class KontorEscrowNotFundedError extends Error {
  readonly escrowOutpoint: string;
  readonly assetKind: KontorAssetKind;
  readonly asset: string;

  constructor(args: {
    escrowOutpoint: string;
    assetKind: KontorAssetKind;
    asset: string;
    detail: string;
  }) {
    super(
      `This Kontor listing is not backed on-chain: ${args.detail}. The seller's ` +
        `escrow (${args.escrowOutpoint}) does not hold the asset, so the sale ` +
        `cannot deliver it. Nothing was paid — the listing should be delisted.`,
    );
    this.name = "KontorEscrowNotFundedError";
    this.escrowOutpoint = args.escrowOutpoint;
    this.assetKind = args.assetKind;
    this.asset = args.asset;
  }
}

/** Raw shape of the Kontor indexer's `/signers/{identifier}` response. */
interface SignerLookupResponse {
  result?: { signer_id?: number | null } | null;
}

/**
 * Resolve a wallet's registered Kontor signer-id, distinguishing "not
 * registered" (→ `null`) from "lookup failed" (→ throws).
 *
 * {@link resolveSignerId} swallows network errors into `null`, which is right
 * for a balance *display* (fall back to x-only holders) but wrong for a gate:
 * a flaky indexer would read as "you have no KOR" and block a legitimate sale.
 */
async function lookupSignerId(
  indexerUrl: string,
  xOnlyPubkey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<number | null> {
  const base = indexerUrl.replace(/\/+$/, "");
  const key = xOnlyPubkey.toLowerCase().replace(/^0x/, "");
  const res = await fetchImpl(`${base}/signers/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Kontor signer lookup failed (HTTP ${res.status}) — cannot verify the ` +
        `gas balance for this wallet.`,
    );
  }
  const data = (await res.json()) as SignerLookupResponse;
  const id = data.result?.signer_id;
  return typeof id === "number" ? id : null;
}

export interface KontorGasBalanceArgs {
  /** Any session bound to the paying wallet — read-only is enough. */
  session: KontorSession;
  /** Kontor indexer base URL (for the signer-id lookup). */
  indexerUrl: string;
  /** `fetch` implementation (injected for tests / custom runtimes). */
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * The holders the node itself will use for this wallet, in the two forms the
 * contracts can report: `signer-id(N)` and the raw x-only key.
 *
 * Deliberately **narrower than {@link holderCandidates}**, which also queries
 * the bech32m-tweaked taproot *output* key for balance display. That tweaked key
 * is a different Kontor identity with its own signer-id: the node resolves the
 * payer from the commit envelope's `x_only_public_key` (the session's *internal*
 * key) and `attach` moves the asset from `ctx.signer()` — the same identity.
 * Counting the tweaked key's holdings here would let a wallet clear the gate on
 * KOR the node cannot spend, which is the exact silent failure this module
 * exists to prevent. Blocking is the safe side: the op would have been dropped
 * anyway, only without telling anyone.
 *
 * Both forms name the same ledger row — crediting an x-only holder-ref
 * canonicalises to `signer-id` at write time — so a caller compares against
 * either, and reads through whichever one exists.
 */
function payerHolders(signerId: number | null, xOnly: string): HolderRef[] {
  const holders: HolderRef[] = [];
  if (signerId != null) holders.push(HolderRef.signerId(BigInt(signerId)));
  holders.push(HolderRef.xOnlyPubkey(xOnly.toLowerCase().replace(/^0x/, "")));
  return holders;
}

/**
 * KOR a wallet holds, read through its registered signer-id.
 *
 * An unregistered wallet is **provably** empty and is answered without a chain
 * read: every credit path canonicalises its holder-ref to a signer-id row and
 * creates the signer entry on the way, so "no signer row" implies "no holdings".
 * Skipping the read is also what keeps this correct — a holder-ref view for an
 * unknown x-only key is a deterministic *error* inside the node ("signer not
 * found … view context"), not an empty balance, so querying it would turn the
 * commonest case (a brand-new wallet with no KOR) into a cryptic failure instead
 * of {@link KontorInsufficientGasError}.
 */
async function readKorBalance(
  session: KontorSession,
  signerId: number | null,
): Promise<string> {
  if (signerId === null) return "0";
  const balance = await bindKontorToken(session).balance(
    HolderRef.signerId(BigInt(signerId)),
  );
  return balance?.toString() ?? "0";
}

/**
 * Read the KOR balance the node would draw gas from.
 *
 * Gas is held from `Holder::for_signer_id(payer)`, where the payer's signer-id
 * is resolved from the input's x-only key — so the signer-id holder is the
 * authoritative one, and the only one worth reading. See {@link payerHolders}.
 */
export async function readKontorGasBalance(
  args: KontorGasBalanceArgs,
): Promise<{ signerId: number | null; balanceKor: string }> {
  const { session, indexerUrl } = args;
  const fetchImpl = args.fetch ?? globalThis.fetch.bind(globalThis);

  const signerId = await lookupSignerId(
    indexerUrl,
    session.identity.xOnlyPubKey,
    fetchImpl,
  );
  return { signerId, balanceKor: await readKorBalance(session, signerId) };
}

export interface AssertKontorGasArgs extends KontorGasBalanceArgs {
  /** Gas limit the upcoming op commits to. */
  gasLimit: number;
  /** Flow being gated — drives the error wording. */
  operation: KontorGasOperation;
}

/**
 * The gas half of a pre-flight: read the payer's balance and price the op,
 * *without* deciding what to do about a shortfall.
 *
 * Split out because the same read serves two callers with opposite ergonomics —
 * the workflows want a throw, and {@link preflightKontorListing} & friends want
 * the numbers either way, so a review screen can print "gas ≈ 0.0001 KOR" next
 * to a balance it just read rather than re-reading it.
 */
async function readGasCheck(args: AssertKontorGasArgs): Promise<{
  signerId: number | null;
  balanceKor: string;
  requiredKor: string;
  gasLimit: number;
  error: KontorInsufficientGasError | null;
}> {
  const { signerId, balanceKor } = await readKontorGasBalance(args);
  const requiredKor = korCostForGas(args.gasLimit);
  const short =
    Decimal.from(balanceKor).cmp(Decimal.from(requiredKor)) === "less";

  return {
    signerId,
    balanceKor,
    requiredKor,
    gasLimit: args.gasLimit,
    error: short
      ? new KontorInsufficientGasError({
          operation: args.operation,
          requiredKor,
          availableKor: balanceKor,
          gasLimit: args.gasLimit,
          signerId,
          xOnlyPubkey: args.session.identity.xOnlyPubKey,
        })
      : null,
  };
}

/**
 * Throw {@link KontorInsufficientGasError} when the wallet cannot cover the
 * gas an upcoming Kontor op commits to. Call before signing or broadcasting.
 */
export async function assertKontorGasBalance(
  args: AssertKontorGasArgs,
): Promise<void> {
  const { error } = await readGasCheck(args);
  if (error) throw error;
}

/** `"txid:vout"` → its parts. Throws on anything malformed. */
function parseOutpoint(outpoint: string): { txid: string; vout: number } {
  const [txid, rawVout] = outpoint.split(":");
  const vout = Number.parseInt(rawVout ?? "", 10);
  if (!txid || !Number.isInteger(vout) || vout < 0) {
    throw new Error(`Malformed Kontor escrow outpoint: ${outpoint}`);
  }
  return { txid, vout };
}

/** Structural equality for two holder refs (hex compared case-insensitively). */
export function holderRefEquals(a: HolderRef, b: HolderRef): boolean {
  const x = a.unwrap();
  const y = b.unwrap();
  if (x.kind !== y.kind) return false;
  switch (x.kind) {
    case "x-only-pubkey":
      return (
        x.value.toLowerCase() ===
        (y as { value: string }).value.toLowerCase()
      );
    case "signer-id":
      return x.value === (y as { value: bigint }).value;
    case "utxo": {
      const other = (y as { value: { txid: string; vout: number } }).value;
      return (
        x.value.txid.toLowerCase() === other.txid.toLowerCase() &&
        x.value.vout === other.vout
      );
    }
    default:
      return true;
  }
}

export interface KontorAssetCheckArgs {
  session: KontorSession;
  indexerUrl: string;
  fetch?: typeof globalThis.fetch | undefined;
  assetKind: KontorAssetKind;
  /** NFT id — required when `assetKind === "nft"`. */
  nftId?: string | null | undefined;
  /** NFT contract address — required when `assetKind === "nft"`. */
  contractAddress?: string | null | undefined;
  /** KOR amount as a decimal string — required when `assetKind === "token"`. */
  korAmount?: string | null | undefined;
  /**
   * KOR that must remain spendable *on top of* `korAmount` — the gas the same
   * op holds. Only meaningful when `assetKind === "token"`, where the asset
   * being escrowed and the gas come out of one balance.
   */
  reserveKor?: string | null | undefined;
}

/**
 * Throw {@link KontorAssetUnavailableError} when the wallet does not hold the
 * asset it is about to escrow. Catches the "wrong account connected" and
 * "already listed / already sold" cases before the attach reveal is broadcast
 * and paid for.
 */
export async function assertKontorAssetAvailable(
  args: KontorAssetCheckArgs,
): Promise<void> {
  const fetchImpl = args.fetch ?? globalThis.fetch.bind(globalThis);
  const signerId = await lookupSignerId(
    args.indexerUrl,
    args.session.identity.xOnlyPubKey,
    fetchImpl,
  );
  return assertAssetAvailableForPayer(args, { signerId });
}

/**
 * {@link assertKontorAssetAvailable}'s body, over an already-resolved payer.
 *
 * The reporting form prices the gas first, and that read has *already* resolved
 * the signer-id and (for a token listing) the KOR balance — the very two values
 * this check needs. Taking them as arguments turns a listing pre-flight from two
 * signer lookups and two balance reads into one of each. They describe the same
 * wallet at the same moment, so reusing them also removes a window where the two
 * halves of one verdict could disagree.
 */
async function assertAssetAvailableForPayer(
  args: KontorAssetCheckArgs,
  payer: { signerId: number | null; balanceKor?: string },
): Promise<void> {
  const { session } = args;
  const { signerId } = payer;
  const candidates = payerHolders(signerId, session.identity.xOnlyPubKey);

  if (args.assetKind === "nft") {
    const nftId = args.nftId;
    const contractAddress = args.contractAddress;
    if (!nftId || !contractAddress) {
      throw new Error(
        "Kontor NFT listings require nftId and nftContractAddress",
      );
    }
    const info = await bindKontorNft(session, contractAddress).getInfo(nftId);
    if (!info) {
      throw new KontorAssetUnavailableError({
        assetKind: "nft",
        asset: nftId,
        detail: `${nftId} does not exist on ${contractAddress}`,
      });
    }
    if (!candidates.some((holder) => holderRefEquals(info.owner, holder))) {
      throw new KontorAssetUnavailableError({
        assetKind: "nft",
        asset: nftId,
        detail:
          `${nftId} is not held by the connected wallet (it is currently held ` +
          `by ${describeHolder(info.owner)}). Connect the owning wallet, or ` +
          `delist it first if it is already escrowed in another listing`,
      });
    }
    return;
  }

  const korAmount = args.korAmount;
  if (!korAmount) {
    throw new Error("Kontor token listings require korAmount (decimal string)");
  }
  const available =
    payer.balanceKor ?? (await readKorBalance(session, signerId));
  // Listing KOR spends from the same balance the op's gas is held against, and
  // the hold lands *first* — so a wallet listing its entire balance clears both
  // checks taken separately and still has its `attach` fail for want of the few
  // hundred µKOR of gas. Require the sum.
  const reserve = args.reserveKor || "0";
  const required = Decimal.from(korAmount).add(Decimal.from(reserve));
  if (Decimal.from(available).cmp(required) === "less") {
    const withGas =
      Decimal.from(reserve).cmp(Decimal.from("0")) === "greater"
        ? ` plus the ${reserve} KOR held for network gas`
        : "";
    throw new KontorAssetUnavailableError({
      assetKind: "token",
      asset: korAmount,
      availableKor: available,
      detail:
        `this wallet holds ${available} KOR, less than the ${korAmount} KOR ` +
        `being listed${withGas}`,
    });
  }
}

export interface KontorEscrowCheckArgs {
  session: KontorSession;
  /** The listing's escrow outpoint (`assetUtxoId`, always `<attachTxid>:0`). */
  escrowOutpoint: string;
  assetKind: KontorAssetKind;
  nftId?: string | null | undefined;
  contractAddress?: string | null | undefined;
  korAmount?: string | null | undefined;
}

/**
 * Throw {@link KontorEscrowNotFundedError} when the listing's escrow UTXO does
 * not hold the advertised asset — i.e. the seller's `attach` op never landed.
 *
 * Used as the buyer's pre-flight (before `accept()` pays the seller), and
 * re-usable as the seller's post-condition once the attach reveal has been
 * mined: Kontor executes a transaction's ops when its block is processed, so
 * the escrow only becomes visible after the attach reveal confirms.
 */
export async function assertKontorEscrowHoldsAsset(
  args: KontorEscrowCheckArgs,
): Promise<void> {
  const { session, escrowOutpoint, assetKind } = args;
  const { txid, vout } = parseOutpoint(escrowOutpoint);
  const escrowHolder = HolderRef.utxo({ txid, vout });

  if (assetKind === "nft") {
    const nftId = args.nftId;
    const contractAddress = args.contractAddress;
    if (!nftId || !contractAddress) {
      throw new Error(
        "Kontor NFT listings require kontorNftId and kontorContractAddress",
      );
    }
    const info = await bindKontorNft(session, contractAddress).getInfo(nftId);
    if (!info) {
      throw new KontorEscrowNotFundedError({
        escrowOutpoint,
        assetKind,
        asset: nftId,
        detail: `${nftId} does not exist on ${contractAddress}`,
      });
    }
    if (!holderRefEquals(info.owner, escrowHolder)) {
      throw new KontorEscrowNotFundedError({
        escrowOutpoint,
        assetKind,
        asset: nftId,
        detail: `${nftId} is held by ${describeHolder(info.owner)}, not by the escrow`,
      });
    }
    return;
  }

  const korAmount = args.korAmount;
  if (!korAmount) {
    throw new Error("Kontor token listings require kontorAmount");
  }
  const escrowed = await bindKontorToken(session).balance(escrowHolder);
  const held = escrowed?.toString() ?? "0";
  if (Decimal.from(held).cmp(Decimal.from(korAmount)) === "less") {
    throw new KontorEscrowNotFundedError({
      escrowOutpoint,
      assetKind,
      asset: korAmount,
      detail: `the escrow holds ${held} KOR, less than the ${korAmount} KOR advertised`,
    });
  }
}

// ─── Reporting form: the same checks, answered instead of thrown ────────────

/**
 * The three refusals a pre-flight *reports*. Everything else — an unreachable
 * indexer, a malformed outpoint, a missing parameter — is a failure to *check*,
 * not a verdict, and is thrown rather than folded into `ok: false`.
 */
export type KontorPreflightRefusal =
  | KontorInsufficientGasError
  | KontorAssetUnavailableError
  | KontorEscrowNotFundedError;

/**
 * True for the errors that mean "this Kontor flow would not execute" — as
 * opposed to "the check itself failed".
 *
 * Also useful on the *throwing* side: a host catching from `openSellOrder` /
 * `fillSwaps` / `delistSwap` can use it to tell a safe, nothing-happened
 * refusal from a real failure, without importing three classes to `instanceof`.
 */
export function isKontorPreflightRefusal(
  err: unknown,
): err is KontorPreflightRefusal {
  return (
    err instanceof KontorInsufficientGasError ||
    err instanceof KontorAssetUnavailableError ||
    err instanceof KontorEscrowNotFundedError
  );
}

/** What a pre-flight learned about the paying wallet and the op it gates. */
export interface KontorPreflightResult {
  /** True when every check passed: the flow can be submitted. */
  ok: boolean;
  /** The refusal when `ok` is false, else null. Never an infrastructure error. */
  error: KontorPreflightRefusal | null;
  /** KOR the paying wallet's Kontor account holds, decimal string. */
  balanceKor: string;
  /** KOR this op's gas limit costs, decimal string. */
  requiredKor: string;
  /** Gas limit the op commits to. */
  gasLimit: number;
  /** Payer's registered Kontor signer-id, or null when never registered. */
  signerId: number | null;
}

/**
 * Run `check` and fold a refusal into the result; rethrow anything else.
 *
 * The asserts throw by design (the workflows want that), so the reporting form
 * calls the very same functions and classifies what comes back — rather than
 * re-implementing the checks and letting the two drift.
 */
async function report(
  gas: Awaited<ReturnType<typeof readGasCheck>>,
  check: () => Promise<void>,
): Promise<KontorPreflightResult> {
  const base = {
    balanceKor: gas.balanceKor,
    requiredKor: gas.requiredKor,
    gasLimit: gas.gasLimit,
    signerId: gas.signerId,
  };
  if (gas.error) return { ok: false, error: gas.error, ...base };
  try {
    await check();
  } catch (err) {
    if (isKontorPreflightRefusal(err)) return { ok: false, error: err, ...base };
    throw err;
  }
  return { ok: true, error: null, ...base };
}

/**
 * What a listing pre-flight needs to know about the asset — the subset of
 * `KontorSellParams` that decides ownership, so a caller can pass the very
 * params they are about to submit.
 */
export type KontorListingPreflightParams =
  | { kontorAssetKind: "token"; korAmount: string }
  | { kontorAssetKind: "nft"; nftId: string; nftContractAddress: string };

export interface KontorListingPreflightArgs extends KontorGasBalanceArgs {
  assetKind: KontorAssetKind;
  /** NFT id — required when `assetKind === "nft"`. */
  nftId?: string | null | undefined;
  /** NFT contract address — required when `assetKind === "nft"`. */
  contractAddress?: string | null | undefined;
  /** KOR amount as a decimal string — required when `assetKind === "token"`. */
  korAmount?: string | null | undefined;
}

/**
 * Would this Kontor listing execute? Gas for the attach, plus the wallet
 * actually holding what it is about to escrow.
 *
 * The exact gate `openSellOrder` applies, in reporting form — so a review
 * screen can refuse *before* asking the user to confirm, instead of after.
 */
export async function preflightKontorListing(
  args: KontorListingPreflightArgs,
): Promise<KontorPreflightResult> {
  const gas = await readGasCheck({
    ...args,
    gasLimit: KONTOR_ATTACH_GAS_LIMIT,
    operation: "listing",
  });
  return report(gas, () =>
    assertAssetAvailableForPayer(
      {
        ...args,
        // Listing KOR escrows from the same balance the attach's gas is held
        // against, so the two claims compete: require both at once.
        reserveKor:
          args.assetKind === "token"
            ? korCostForGas(KONTOR_ATTACH_GAS_LIMIT)
            : null,
      },
      // Reuse what pricing the gas already read — same wallet, same moment.
      { signerId: gas.signerId, balanceKor: gas.balanceKor },
    ),
  );
}

export interface KontorPurchasePreflightArgs extends KontorGasBalanceArgs {
  /** The listing's escrow outpoint (`assetUtxoId`), when it has one. */
  escrowOutpoint?: string | null | undefined;
  assetKind?: KontorAssetKind | null | undefined;
  nftId?: string | null | undefined;
  contractAddress?: string | null | undefined;
  korAmount?: string | null | undefined;
}

/**
 * Everything the escrow check needs, or null when this listing does not record
 * enough to run it.
 *
 * The fields naming a Kontor listing's asset (`assetUtxoId`, `kontorAssetKind`,
 * `kontorNftId` / `kontorContractAddress`, `kontorAmount`) are each nullable on
 * `AtomicSwap`: a listing written before the escrow convention, or by a
 * third-party client, may carry only some of them. Absent means *unverifiable*,
 * not *unbacked* — so the escrow half is skipped and the gas half still runs,
 * leaving that listing exactly as buyable as it is today rather than turning it
 * unbuyable behind a parameter error.
 *
 * A field that is *present but malformed* is a different thing and deliberately
 * not covered here: {@link assertKontorEscrowHoldsAsset} throws on it, because
 * corrupted listing data is worth surfacing rather than silently disarming the
 * check that protects the buyer's money.
 */
function escrowCheckArgs(
  args: KontorPurchasePreflightArgs,
): KontorEscrowCheckArgs | null {
  const { escrowOutpoint, assetKind } = args;
  if (!escrowOutpoint || !assetKind) return null;
  const base = { session: args.session, escrowOutpoint };
  if (assetKind === "nft") {
    if (!args.nftId || !args.contractAddress) return null;
    return {
      ...base,
      assetKind,
      nftId: args.nftId,
      contractAddress: args.contractAddress,
    };
  }
  if (!args.korAmount) return null;
  return { ...base, assetKind, korAmount: args.korAmount };
}

/**
 * Would this Kontor purchase execute? Gas for the buyer's `Sponsor`, plus the
 * listing's escrow really holding the advertised asset.
 *
 * The exact gate `fillSwaps` applies, in reporting form. A listing that doesn't
 * record enough to locate its escrowed asset can't be verified, so only the gas
 * is checked — same as the workflow. See {@link escrowCheckArgs}.
 */
export async function preflightKontorPurchase(
  args: KontorPurchasePreflightArgs,
): Promise<KontorPreflightResult> {
  const gas = await readGasCheck({
    ...args,
    gasLimit: KONTOR_ACCEPT_GAS_LIMIT,
    operation: "purchase",
  });
  const escrow = escrowCheckArgs(args);
  return report(gas, async () => {
    if (!escrow) return;
    await assertKontorEscrowHoldsAsset(escrow);
  });
}

export interface KontorDelistPreflightArgs extends KontorGasBalanceArgs {
  /** The listing's signed offer blob — the detach's gas limit is read from it. */
  offerBlob: string;
}

/**
 * Would this Kontor delist execute? Gas for the seller's `detach`, priced from
 * the limit baked into that offer blob.
 *
 * The exact gate `delistSwap` applies, in reporting form — and the one worth
 * surfacing early: a revoke spends the escrow UTXO, so a dropped detach can
 * never be retried.
 */
export async function preflightKontorDelist(
  args: KontorDelistPreflightArgs,
): Promise<KontorPreflightResult> {
  const gas = await readGasCheck({
    ...args,
    gasLimit: detachGasLimitFromBlob(args.offerBlob),
    operation: "delist",
  });
  return report(gas, () => Promise.resolve());
}

/** Short human description of a holder ref, for error messages. */
export function describeHolder(holder: HolderRef): string {
  const v = holder.unwrap();
  switch (v.kind) {
    case "signer-id":
      return `signer-id(${v.value.toString()})`;
    case "x-only-pubkey":
      return `key ${v.value.slice(0, 12)}…`;
    case "utxo":
      return `utxo ${v.value.txid.slice(0, 12)}…:${v.value.vout}`;
    case "core":
      return "the core identity";
    case "burner":
      return "the burner";
  }
}
