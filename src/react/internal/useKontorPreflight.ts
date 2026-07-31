import { useCallback, useEffect, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import type { AtomicSwap } from "../../types/index.js";
// Type-only: erased at compile time, so the WASM-free React bundle stays free
// of `kontor/preflight.js` (which does import `@kontor/sdk`). The call itself
// goes through `client.preflightKontor*`, which loads that chunk dynamically.
import type { KontorListingPreflightParams } from "../../kontor/preflight.js";

/** Which Kontor flow to ask about, and what it would act on. */
export type KontorPreflightTarget =
  | { flow: "listing"; params: KontorListingPreflightParams }
  | { flow: "purchase"; swap: AtomicSwap }
  | { flow: "delist"; swap: AtomicSwap };

export interface UseKontorPreflightResult {
  /** True while the chain is being asked. */
  loading: boolean;
  /**
   * Why this flow would not execute, in the words the SDK's refusal uses
   * ("Not enough KOR to pay Kontor network gas. …"), or null when nothing
   * refuses it. The only value that should disable a submit button.
   */
  blockedReason: string | null;
  /**
   * The check itself could not be made — an unreachable indexer, Kontor not
   * configured for this client. **Not** a refusal, and deliberately not a
   * blocker: see {@link useKontorPreflight}.
   */
  checkError: Error | null;
  /** KOR this op's gas costs, decimal string (null until read). */
  requiredKor: string | null;
  /** KOR the wallet's Kontor account holds, decimal string (null until read). */
  balanceKor: string | null;
  /** False only when the chain says the flow would not execute. */
  canSubmit: boolean;
  /** Ask again — e.g. after the user has funded their Kontor account. */
  recheck: () => void;
}

const IDLE: Omit<UseKontorPreflightResult, "recheck"> = {
  loading: false,
  blockedReason: null,
  checkError: null,
  requiredKor: null,
  balanceKor: null,
  canSubmit: true,
};

/**
 * Identity of what is being checked, so the effect re-runs when the *subject*
 * changes and not merely when a caller rebuilt an equivalent params object.
 * The connected address is part of it: the answer is about a wallet, so
 * switching wallets must re-ask.
 */
function targetKey(
  target: KontorPreflightTarget | null,
  address: string | null | undefined,
): string | null {
  if (!target) return null;
  const who = address ?? "";
  if (target.flow !== "listing") {
    return `${target.flow}:${target.swap.id}:${who}`;
  }
  const p = target.params;
  return p.kontorAssetKind === "nft"
    ? `listing:nft:${p.nftContractAddress}:${p.nftId}:${who}`
    : `listing:token:${p.korAmount}:${who}`;
}

/**
 * Ask the chain whether a Kontor flow would actually execute, before offering
 * the user a button that commits to it.
 *
 * The workflows (`openSellOrder` / `fillSwaps` / `delistSwap`) run this very
 * check and refuse to broadcast when it fails, so nothing unsafe can get
 * through either way — what this adds is *when* the user finds out. Without it
 * they confirm, watch a progress modal, and read the refusal on the result
 * screen; with it the review screen refuses up front and says what to fix.
 *
 * **A failed check never blocks.** `client.preflightKontor*` resolves with a
 * verdict for the three things a wallet can fix and *throws* when the check
 * itself couldn't be made — an unreachable indexer must not read as "you have
 * no KOR". Blocking on that would strand a perfectly funded user behind a
 * transient outage, and it would buy nothing: the workflow re-runs the same
 * check at submit time and refuses there if the chain can be reached at all.
 * So a `checkError` is surfaced as a note and the button stays enabled.
 *
 * Idle (and free) when `target` is null, no wallet is connected, or the client
 * has no Kontor network — every case where there is nothing to ask about.
 */
export function useKontorPreflight(
  target: KontorPreflightTarget | null,
): UseKontorPreflightResult {
  const { client, addresses, kontorNetwork } = useHorizonMarket();
  const [state, setState] = useState(IDLE);
  const [nonce, setNonce] = useState(0);
  const seqRef = useRef(0);

  // The effect keys off `key`, not the target object, so a caller re-rendering
  // with a fresh-but-equal params object doesn't re-hit the indexer. The target
  // itself is read through a ref at call time.
  const key = targetKey(target, addresses?.p2tr);
  const targetRef = useRef(target);
  targetRef.current = target;

  const enabled = key !== null && !!client && !!addresses && !!kontorNetwork;

  useEffect(() => {
    if (!enabled) {
      seqRef.current++; // strand any in-flight answer
      setState(IDLE);
      return;
    }
    const current = targetRef.current;
    if (!current) return;

    const seq = ++seqRef.current;
    setState({ ...IDLE, loading: true });

    const ask =
      current.flow === "listing"
        ? client.preflightKontorListing(current.params)
        : current.flow === "purchase"
          ? client.preflightKontorPurchase(current.swap)
          : client.preflightKontorDelist(current.swap);

    ask
      .then((verdict) => {
        if (seq !== seqRef.current) return;
        setState({
          loading: false,
          blockedReason: verdict.error?.message ?? null,
          checkError: null,
          requiredKor: verdict.requiredKor,
          balanceKor: verdict.balanceKor,
          canSubmit: verdict.ok,
        });
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setState({
          ...IDLE,
          checkError: err instanceof Error ? err : new Error(String(err)),
        });
      });
    // `nonce` is the recheck trigger; `key` covers every real input.
  }, [enabled, key, nonce, client]);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, recheck };
}

/** What a pre-flight has to say on a review screen, if anything. */
export interface KontorPreflightNotice {
  /**
   * `"blocked"` — the flow would not execute; the submit button is disabled and
   * this says why. `"warning"` — the check couldn't be made; the button stays
   * enabled and this says the guarantee is weaker than usual.
   */
  tone: "blocked" | "warning";
  text: string;
}

/**
 * The one place the pre-flight's wording is decided, so the web and native
 * renderers cannot drift — each only picks the style for the returned `tone`.
 *
 * Returns null while loading: a spinner's worth of "checking…" on a panel that
 * already has a disabled button is noise, and the refusal (when there is one)
 * arrives a moment later with the actual answer.
 */
export function kontorPreflightNotice(
  preflight: UseKontorPreflightResult,
): KontorPreflightNotice | null {
  if (preflight.blockedReason) {
    return { tone: "blocked", text: preflight.blockedReason };
  }
  if (preflight.checkError) {
    return {
      tone: "warning",
      text:
        `Couldn't check this against the Kontor network: ` +
        `${preflight.checkError.message} You can still continue — the same ` +
        `check runs again before anything is signed or broadcast.`,
    };
  }
  return null;
}
