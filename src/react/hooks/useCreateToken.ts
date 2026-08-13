import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import { usePrices } from "./usePrices.js";
import { useFeeEstimates, type FeeEstimates } from "./useFeeEstimates.js";
import { CLIENT_NOT_INITIALIZED, mempoolTxUrl } from "../internal/format.js";
import { FEE_LABELS, rateForOption, type FeeOption } from "../internal/feeRate.js";
import {
  creationCostLines,
  formatXcp,
  xcpFeeNotice,
  type CreationCostLine,
} from "../internal/creationCost.js";
import { stepMessages } from "../../workflows/progress.js";
import {
  creationQuoteParams,
  creationRetry,
  type CreateTokenParams,
  type CreateTokenResult,
  type CreationRetry,
} from "../../workflows/create.js";
import {
  MAX_CREATION_ATTRIBUTES,
  MAX_CREATION_DESCRIPTION_LENGTH,
  MAX_CREATION_NAME_LENGTH,
  type CreatableType,
  type CreationAttributes,
  type CreationMediaUpload,
  type CreationQuote,
} from "../../api/creations.js";
import {
  validateCounterpartyAssetName,
  validateCreationAttributes,
  validateCreationQuantity,
} from "../../creation-params.js";
import type { WorkflowProgressEvent } from "../../types/index.js";

export type CreateTokenStepName = "form" | "confirm" | "progress" | "result";
export type CreateTokenStatus = "idle" | "loading" | "success" | "error";

/** One editable metadata row. `id` keeps a row's inputs stable across edits. */
export interface CreateTokenAttribute {
  id: string;
  key: string;
  value: string;
}

export interface CreateTokenFormValues {
  type: CreatableType;
  name: string;
  description: string;
  /** `ipfs://` URI of the pinned media; `null` until an upload lands. */
  image: string | null;
  /** `ipfs://` thumbnail, pinned alongside the image. */
  thumbnail: string | null;
  /** Local picker URI, for the on-screen preview only — never sent. */
  imagePreviewUri: string | null;
  quantity: string;
  divisible: boolean;
  lock: boolean;
  attributes: CreateTokenAttribute[];
}

/** Which fields a form should mark as wrong, keyed by field. */
export type CreateTokenFieldErrors = Partial<
  Record<"name" | "description" | "image" | "quantity" | "attributes", string>
>;

/**
 * What registering the name costs in XCP, and whether the wallet can cover it.
 *
 * `sufficient: null` means the balance is unknown — the Counterparty API is not
 * configured for this network, or the read failed. That never blocks: a warning
 * beats refusing to create on a balance we could not read.
 *
 * The balance is the **funding address's** alone. Counterparty debits the name
 * fee from the issuance's source address, so XCP sitting on the wallet's taproot
 * address cannot pay for it — counting it would wave through a creation that
 * fails at compose time, after the quote has already spent a pin.
 */
export interface CreateTokenXcpFee {
  requiredXcp: number;
  /** XCP held by the funding address, or `null` when it could not be read. */
  balanceXcp: number | null;
  sufficient: boolean | null;
  checking: boolean;
  /** Ready-made sentence for the review, or `null` when there is no fee. */
  notice: string | null;
}

export interface UseCreateTokenOptions {
  defaultSatsPerVbyte?: number;
  onSuccess?: (result: CreateTokenResult) => void;
  onError?: (error: Error) => void;
}

export interface UseCreateTokenResult {
  step: CreateTokenStepName;
  formValues: CreateTokenFormValues;
  setFormValues: (
    update:
      | Partial<CreateTokenFormValues>
      | ((prev: CreateTokenFormValues) => CreateTokenFormValues),
  ) => void;

  // Attribute rows
  addAttribute: () => void;
  updateAttribute: (
    id: string,
    patch: Partial<Pick<CreateTokenAttribute, "key" | "value">>,
  ) => void;
  removeAttribute: (id: string) => void;
  /** The rows collapsed to the wire map: blank keys dropped, values trimmed. */
  attributesMap: CreationAttributes;
  canAddAttribute: boolean;

  // Media
  uploadImage: (
    file: CreationMediaUpload,
    previewUri?: string,
  ) => Promise<boolean>;
  uploadingImage: boolean;
  imageError: string | null;
  clearImage: () => void;

  // Fee rate — chosen on the FORM, not in the confirm modal (see the docblock).
  estimates: FeeEstimates | null;
  feeOption: FeeOption;
  setFeeOption: (option: FeeOption) => void;
  /** `"slow"` is withheld for ordinals — that reveal can never be fee-bumped. */
  feeOptions: FeeOption[];
  feeLabels: Record<FeeOption, string>;
  feeRate: number | undefined;
  rateFor: (option: FeeOption) => number | undefined;
  btcUsd: number | null;

  // Validation
  fieldErrors: CreateTokenFieldErrors;
  canQuote: boolean;
  /** True for ordinals: quantity / divisible / lock are pinned at their defaults. */
  advancedReadOnly: boolean;
  xcpFee: CreateTokenXcpFee;

  // Quote → confirm
  requestQuote: () => Promise<void>;
  quoting: boolean;
  quote: CreationQuote | null;
  costLines: CreationCostLine[];

  // Confirm → run
  confirmAndCreate: () => Promise<void>;
  /**
   * Back to the form — from the confirm step, or from a failure the server
   * positively rejected before broadcasting.
   *
   * **Refuses while {@link awaitingReplay} is set**, where `retry()` is the only
   * way out: see that field.
   */
  goBack: () => void;
  retry: () => void;
  reset: () => void;

  steps: WorkflowProgressEvent[];
  totalSteps: number | null;
  status: CreateTokenStatus;
  isSubmitting: boolean;
  result: CreateTokenResult | null;
  error: Error | null;
  /**
   * The transaction may be on-chain and the server did not confirm the creation
   * — `retry()` re-sends the same signed transaction rather than composing a new
   * one.
   *
   * **This is the flag a UI branches on.** While it is set the run has exactly
   * one safe exit, and `goBack()` refuses: returning to the form would drop the
   * body only `retry()` can replay, and the next Create would compose and
   * broadcast a **second** transaction — for an ordinal, stranding this one's
   * funds forever. Hide the Back and dismiss affordances whenever it is true,
   * leaving Retry.
   *
   * It is deliberately wider than {@link commitTxid}: a submit the server never
   * positively rejected counts, txid or no txid.
   */
  awaitingReplay: boolean;
  /**
   * The commit txid, when the failure named one — for display only.
   *
   * A `null` does **not** mean nothing was broadcast; branch on
   * {@link awaitingReplay} for that.
   */
  commitTxid: string | null;
  /** mempool.space link to the created transaction, on success. */
  trackUrl: string | null;
}

const initialForm: CreateTokenFormValues = {
  type: "counterparty",
  name: "",
  description: "",
  image: null,
  thumbnail: null,
  imagePreviewUri: null,
  quantity: "1",
  divisible: false,
  lock: true,
  attributes: [],
};

const ORDINALS_FEE_OPTIONS: FeeOption[] = ["normal", "fast"];
const ALL_FEE_OPTIONS: FeeOption[] = ["slow", "normal", "fast"];

/** XCP is divisible, so its balances arrive in 1e8 base units. */
const XCP_UNIT = 100_000_000;
const XCP_BALANCE_DEBOUNCE_MS = 400;

let attributeSeq = 0;
function nextAttributeId(): string {
  attributeSeq += 1;
  return `attr-${attributeSeq}`;
}

/**
 * A signed submit that failed, held so every subsequent recovery replays *it*
 * rather than composing a second transaction.
 *
 * It carries its own quote because the replay's result must report the quote the
 * broadcast transaction was actually composed from — which the form's held quote
 * stops being the moment anything is edited.
 */
interface PendingCreationRetry extends CreationRetry {
  quote: CreationQuote;
}

/**
 * An ordinal is one indivisible, locked inscription: the API takes no supply
 * options for it, so the three Counterparty fields are pinned rather than sent.
 * Enforced here rather than in the form, so a custom UI cannot bypass it.
 */
function normalize(values: CreateTokenFormValues): CreateTokenFormValues {
  if (values.type !== "ordinals") return values;
  if (values.quantity === "1" && !values.divisible && values.lock) return values;
  return { ...values, quantity: "1", divisible: false, lock: true };
}

/**
 * Data layer for a token-creation screen: form → quote → confirm → progress.
 *
 * **The fee rate is chosen on the form, and the confirm step is read-only about
 * money.** Sell and buy can put a fee dropdown in their confirm modal because
 * they have a side-effect-free `preview` quote; a creation quote has no preview
 * and pins an IPFS descriptor (Counterparty) or pulls the media through a
 * gateway (ordinals) every time it is asked, so re-quoting per twiddle would
 * orphan a pin per keystroke. Pressing Create takes exactly one quote, the
 * modal shows those numbers as facts, and any edit afterwards drops the quote
 * so nothing stale can be signed.
 */
export function useCreateToken(
  options?: UseCreateTokenOptions,
): UseCreateTokenResult {
  const { client, addresses, network, kontorNetwork, counterpartyApiBaseUrl } =
    useHorizonMarket();
  const { estimates } = useFeeEstimates();
  const { btcUsd } = usePrices();

  const optsRef = useRef(options);
  optsRef.current = options;

  const [step, setStep] = useState<CreateTokenStepName>("form");
  const [formValues, setFormValuesState] =
    useState<CreateTokenFormValues>(initialForm);
  const [feeOption, setFeeOptionState] = useState<FeeOption>("normal");
  const [quote, setQuote] = useState<CreationQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowProgressEvent[]>([]);
  const [totalSteps, setTotalSteps] = useState<number | null>(null);
  const [status, setStatus] = useState<CreateTokenStatus>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CreateTokenResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingRetry, setPendingRetry] =
    useState<PendingCreationRetry | null>(null);
  const [xcpBalance, setXcpBalance] = useState<number | null>(null);
  const [xcpChecking, setXcpChecking] = useState(false);

  // Refs, not the state flags beside them: two taps land in one React batch, so
  // the second callback still closes over `quoting === false`. A quote is
  // metered — the duplicate would pin a descriptor nobody ever signs.
  const quotingRef = useRef(false);
  const uploadingRef = useRef(false);
  const submittingRef = useRef(false);

  // Everything is funded from — and, for Counterparty, has its XCP name fee
  // debited from — the native segwit address, exactly as `createToken` resolves
  // it. Named once so the quote and the balance check cannot drift apart.
  const fundingAddress = addresses?.p2wpkh ?? null;

  const commitTxid = pendingRetry?.commitTxid ?? null;
  // The flag the exits branch on. `commitTxid` is only what we can *name*; this
  // is what we *know*, and it stays true for a failure the server never
  // positively rejected. See `CreationNotBroadcastError`.
  const awaitingReplay = pendingRetry?.possiblyBroadcast ?? false;

  const feeOptions =
    formValues.type === "ordinals" ? ORDINALS_FEE_OPTIONS : ALL_FEE_OPTIONS;
  // Switching to ordinals withdraws "slow"; land on the cheapest still offered
  // rather than leaving a selection the caller can no longer see.
  const effectiveFeeOption = feeOptions.includes(feeOption)
    ? feeOption
    : "normal";
  const feeRate =
    rateForOption(effectiveFeeOption, estimates) ??
    optsRef.current?.defaultSatsPerVbyte;

  const setFormValues = useCallback<UseCreateTokenResult["setFormValues"]>(
    (update) => {
      setFormValuesState((prev) =>
        normalize(
          typeof update === "function" ? update(prev) : { ...prev, ...update },
        ),
      );
      setError(null);
      // Every quote is composed against the values as they were; keeping one
      // across an edit is how a screen ends up signing something it never showed.
      setQuote(null);
    },
    [],
  );

  const setFeeOption = useCallback((option: FeeOption) => {
    setFeeOptionState(option);
    setQuote(null);
  }, []);

  // ─── Attribute rows ─────────────────────────────────────────────────────────

  const addAttribute = useCallback(() => {
    setFormValuesState((prev) =>
      prev.attributes.length >= MAX_CREATION_ATTRIBUTES
        ? prev
        : {
            ...prev,
            attributes: [
              ...prev.attributes,
              { id: nextAttributeId(), key: "", value: "" },
            ],
          },
    );
    setQuote(null);
  }, []);

  const updateAttribute = useCallback<UseCreateTokenResult["updateAttribute"]>(
    (id, patch) => {
      setFormValuesState((prev) => ({
        ...prev,
        attributes: prev.attributes.map((attr) =>
          attr.id === id ? { ...attr, ...patch } : attr,
        ),
      }));
      setQuote(null);
    },
    [],
  );

  const removeAttribute = useCallback((id: string) => {
    setFormValuesState((prev) => ({
      ...prev,
      attributes: prev.attributes.filter((attr) => attr.id !== id),
    }));
    setQuote(null);
  }, []);

  const attributesMap = useMemo(() => {
    const map: CreationAttributes = {};
    for (const attr of formValues.attributes) {
      const key = attr.key.trim();
      // A blank row is the "+" button's resting state, not an error to send.
      if (key) map[key] = attr.value.trim();
    }
    return map;
  }, [formValues.attributes]);

  // ─── Validation ─────────────────────────────────────────────────────────────

  const duplicateAttributeKey = useMemo(() => {
    const seen = new Set<string>();
    for (const attr of formValues.attributes) {
      const key = attr.key.trim();
      if (!key) continue;
      if (seen.has(key)) return key;
      seen.add(key);
    }
    return null;
  }, [formValues.attributes]);

  const fieldErrors = useMemo<CreateTokenFieldErrors>(() => {
    const errors: CreateTokenFieldErrors = {};

    if (formValues.name.trim().length === 0) {
      errors.name = "Enter a name.";
    } else if (formValues.type === "counterparty") {
      const nameError = validateCounterpartyAssetName(formValues.name.trim());
      if (nameError) errors.name = nameError;
    } else if (formValues.name.trim().length > MAX_CREATION_NAME_LENGTH) {
      errors.name = `Names are at most ${MAX_CREATION_NAME_LENGTH} characters.`;
    }

    if (formValues.description.length > MAX_CREATION_DESCRIPTION_LENGTH) {
      errors.description = `Descriptions are at most ${MAX_CREATION_DESCRIPTION_LENGTH} characters.`;
    }

    if (!formValues.image) errors.image = "Add an image.";

    if (formValues.type === "counterparty") {
      const quantityError = validateCreationQuantity(
        formValues.quantity,
        formValues.divisible,
      );
      if (quantityError) errors.quantity = quantityError;
    }

    const attributesError =
      duplicateAttributeKey !== null
        ? `Duplicate attribute "${duplicateAttributeKey}".`
        : validateCreationAttributes(attributesMap);
    if (attributesError) errors.attributes = attributesError;

    return errors;
  }, [formValues, attributesMap, duplicateAttributeKey]);

  // ─── The XCP name fee ───────────────────────────────────────────────────────

  const nameForFee =
    fieldErrors.name === undefined ? formValues.name.trim() : "";
  const xcpNotice = useMemo(
    () => xcpFeeNotice(formValues.type, nameForFee),
    [formValues.type, nameForFee],
  );
  const requiredXcp = xcpNotice?.requiredXcp ?? 0;

  /** The funding address's XCP, or `null` when nobody could answer. */
  const readXcpBalance = useCallback(async (): Promise<number | null> => {
    if (!client || !fundingAddress) return null;
    try {
      const balances = await client.getCounterpartyBalances([fundingAddress]);
      const xcp = balances.find(
        (row) => row.asset === "XCP" && row.address === fundingAddress,
      );
      if (xcp) return Number(xcp.quantity) / XCP_UNIT;
      // No row is a real zero *when someone was asked*. Without a configured
      // Counterparty API the client answers [] without asking anyone, and
      // reporting that as zero would block a wallet that may well be funded.
      return counterpartyApiBaseUrl ? 0 : null;
    } catch {
      // An unreadable balance is not a reason to refuse — see the docblock on
      // CreateTokenXcpFee.
      return null;
    }
  }, [client, fundingAddress, counterpartyApiBaseUrl]);

  // Read the balance only once there is a fee to cover, and debounce it: the
  // name is typed a character at a time, and this is a live upstream read.
  useEffect(() => {
    if (!client || !fundingAddress || requiredXcp <= 0) {
      setXcpBalance(null);
      setXcpChecking(false);
      return;
    }
    let cancelled = false;
    setXcpChecking(true);
    const timer = setTimeout(() => {
      void readXcpBalance().then((balance) => {
        if (cancelled) return;
        setXcpBalance(balance);
        setXcpChecking(false);
      });
    }, XCP_BALANCE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, fundingAddress, requiredXcp, readXcpBalance]);

  const xcpFee: CreateTokenXcpFee = {
    requiredXcp,
    balanceXcp: xcpBalance,
    sufficient:
      requiredXcp <= 0
        ? true
        : xcpBalance === null
          ? null
          : xcpBalance >= requiredXcp,
    checking: xcpChecking,
    notice: xcpNotice?.text ?? null,
  };

  const canQuote =
    Object.keys(fieldErrors).length === 0 &&
    !uploadingImage &&
    xcpFee.sufficient !== false;

  // ─── Media ──────────────────────────────────────────────────────────────────

  const uploadImage = useCallback(
    async (file: CreationMediaUpload, previewUri?: string) => {
      // Pinning is as metered as quoting, and the second of two taps would
      // orphan a CID nothing ever references.
      if (uploadingRef.current) return false;
      if (!client) {
        setImageError(CLIENT_NOT_INITIALIZED);
        return false;
      }
      uploadingRef.current = true;
      setUploadingImage(true);
      setImageError(null);
      try {
        const media = await client.uploadCreationMedia(file, {
          // Always pin the thumbnail: it costs one extra pin and means changing
          // protocol later never forces a re-upload.
          thumbnail: true,
        });
        setFormValuesState((prev) =>
          normalize({
            ...prev,
            image: media.ipfsUrl,
            thumbnail: media.thumbnailIpfsUrl,
            imagePreviewUri: previewUri ?? prev.imagePreviewUri,
          }),
        );
        setQuote(null);
        return true;
      } catch (err) {
        setImageError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        uploadingRef.current = false;
        setUploadingImage(false);
      }
    },
    [client],
  );

  const clearImage = useCallback(() => {
    setFormValuesState((prev) => ({
      ...prev,
      image: null,
      thumbnail: null,
      imagePreviewUri: null,
    }));
    setImageError(null);
    setQuote(null);
  }, []);

  // ─── Quote → confirm ────────────────────────────────────────────────────────

  const buildParams = useCallback((image: string): CreateTokenParams => {
    const params: CreateTokenParams = {
      type: formValues.type,
      name: formValues.name.trim(),
      image,
    };
    const description = formValues.description.trim();
    if (description) params.description = description;
    if (formValues.thumbnail) params.thumbnail = formValues.thumbnail;
    if (Object.keys(attributesMap).length > 0) params.attributes = attributesMap;
    if (feeRate !== undefined) params.satsPerVbyte = feeRate;
    if (formValues.type === "counterparty") {
      params.options = {
        quantity: formValues.quantity.trim(),
        divisible: formValues.divisible,
        lock: formValues.lock,
      };
    }
    return params;
  }, [formValues, attributesMap, feeRate]);

  const requestQuote = useCallback(async () => {
    if (quotingRef.current) return;
    // A held quote is still the one composed from these exact values — every
    // edit drops it. Re-asking would pin a second, identical descriptor just to
    // re-open the sheet the user backed out of.
    if (quote) {
      setStep("confirm");
      return;
    }
    if (!client) {
      setError(new Error(CLIENT_NOT_INITIALIZED));
      return;
    }
    if (!addresses || !fundingAddress) {
      setError(new Error("Connect a wallet to create a token."));
      return;
    }
    if (!formValues.image) {
      setError(new Error("Add an image before creating."));
      return;
    }
    // Enforced here and not only in the form's `disabled`: quoting is metered,
    // so a custom UI must not be able to spend a pin on values already known to
    // be rejected.
    if (!canQuote) return;
    quotingRef.current = true;
    setQuoting(true);
    setError(null);
    try {
      // The live check is debounced for the form hint, so pressing Create inside
      // that window would otherwise walk straight past the guard — the exact
      // metered failure it exists to prevent. A quote cannot wait on a timer, so
      // settle it here: one Counterparty read is cheap beside the IPFS pin it is
      // protecting, and an unknown balance still warns rather than refusing.
      if (requiredXcp > 0 && xcpBalance === null) {
        const balance = await readXcpBalance();
        setXcpBalance(balance);
        if (balance !== null && balance < requiredXcp) {
          setError(
            new Error(
              `Registering this name costs ${requiredXcp} XCP and the funding ` +
                `address holds ${formatXcp(balance)}. Pick a numeric A… name, ` +
                "or top up.",
            ),
          );
          return;
        }
      }

      // The same resolution `createToken` will apply when it signs — funding
      // address, taproot receive address, public key — rather than a second
      // hand-rolled copy of it, so the quote can never be composed from params
      // other than the ones the transaction is built from. It validates too,
      // which matters most here: this is the call that costs an IPFS pin.
      const composed = await client.requestCreationQuote(
        creationQuoteParams(buildParams(formValues.image), addresses),
      );
      setQuote(composed);
      setStep("confirm");
    } catch (err) {
      // A failed quote leaves the form exactly as it was — there is nothing to
      // confirm, and the message belongs next to the fields that caused it.
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      optsRef.current?.onError?.(e);
    } finally {
      quotingRef.current = false;
      setQuoting(false);
    }
  }, [
    client,
    addresses,
    fundingAddress,
    buildParams,
    formValues.image,
    quote,
    canQuote,
    requiredXcp,
    xcpBalance,
    readXcpBalance,
  ]);

  const costLines = useMemo(
    () => (quote ? creationCostLines(quote, btcUsd) : []),
    [quote, btcUsd],
  );

  // ─── Confirm → run ──────────────────────────────────────────────────────────

  const confirmAndCreate = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (!client) {
        const err = new Error(CLIENT_NOT_INITIALIZED);
        setError(err);
        setStatus("error");
        setStep("result");
        optsRef.current?.onError?.(err);
        return;
      }
      if (!quote || !formValues.image) {
        const err = new Error("No quote to confirm — press Create again.");
        setError(err);
        setStatus("error");
        setStep("result");
        optsRef.current?.onError?.(err);
        return;
      }

      setSteps([]);
      setTotalSteps(null);
      setError(null);
      setResult(null);
      setPendingRetry(null);
      setStatus("loading");
      setStep("progress");

      try {
        // The held quote goes in: the fees on the confirm screen are the fees
        // signed, and the attempt pins no second descriptor.
        const created = await client.createToken(
          { ...buildParams(formValues.image), quote },
          {
            onProgress: (event) => {
              setSteps((prev) => [...prev, event]);
              if (event.totalSteps !== null) setTotalSteps(event.totalSteps);
            },
          },
        );
        setResult(created);
        setStatus("success");
        setStep("result");
        optsRef.current?.onSuccess?.(created);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
        setStep("result");
        // Held rather than re-derived from `error` on each retry: a replay that
        // fails again throws a plain API error carrying no body, and the signed
        // transaction it replaces is still the only thing safe to re-send.
        const recovery = creationRetry(e);
        setPendingRetry(recovery ? { ...recovery, quote } : null);
        optsRef.current?.onError?.(e);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [client, quote, buildParams, formValues.image]);

  /**
   * Replay ONLY the submit, with the exact body that was already signed.
   *
   * The alternative — re-running `createToken` — composes and broadcasts a
   * second transaction, which for an ordinal strands the first commit's funds
   * forever. Keeps the failed run's steps on screen and re-runs the last one.
   */
  const replaySubmit = useCallback(
    async (retryParams: PendingCreationRetry) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);

      try {
        if (!client) {
          const err = new Error(CLIENT_NOT_INITIALIZED);
          setError(err);
          setStatus("error");
          setStep("result");
          optsRef.current?.onError?.(err);
          return;
        }

        const messages = stepMessages("createToken", "submitCreation");
        const total = totalSteps ?? 4;
        const emit = (phase: "start" | "complete" | "error") =>
          setSteps((prev) => [
            ...prev,
            {
              workflow: "createToken",
              step: "submitCreation",
              message:
                phase === "complete"
                  ? messages.complete
                  : phase === "error"
                    ? messages.error
                    : messages.start,
              stepIndex: total,
              totalSteps: total,
              phase,
            },
          ]);

        setError(null);
        setStatus("loading");
        setStep("progress");
        emit("start");

        try {
          const created = await client.submitCreation(retryParams.submit);
          emit("complete");
          // The quote travels with the retry: it is the one the broadcast
          // transaction was composed from, which the form's held quote stops
          // being the moment anything is edited.
          const full: CreateTokenResult = {
            ...created,
            quote: retryParams.quote,
          };
          setResult(full);
          setStatus("success");
          setStep("result");
          setPendingRetry(null);
          optsRef.current?.onSuccess?.(full);
        } catch (err) {
          emit("error");
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          setStatus("error");
          setStep("result");
          // Keep the pending retry: the transaction is still on-chain, so
          // replaying it is still the only safe recovery. This error carries no
          // such body of its own, so it must not replace one.
          optsRef.current?.onError?.(e);
        }
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [client, totalSteps],
  );

  const goBack = useCallback(() => {
    if (step === "confirm") {
      setStep("form");
      return;
    }
    if (step !== "result" || status !== "error") return;
    // A transaction that may have reached the network has exactly one safe exit,
    // and it is forward: `retry()` re-sends it. Going back would drop the body
    // only that replay can use, and the next Create would compose and broadcast
    // a SECOND transaction — for an ordinal, stranding this one's funds forever.
    if (awaitingReplay) return;
    setError(null);
    // Nothing was broadcast, so this attempt is genuinely abandoned: the status
    // goes back to idle with it, rather than leaving a `retry()` live over a run
    // the user walked away from.
    setPendingRetry(null);
    setStatus("idle");
    setStep("form");
  }, [step, status, awaitingReplay]);

  const retry = useCallback(() => {
    if (status !== "error") return;
    if (pendingRetry) {
      void replaySubmit(pendingRetry);
      return;
    }
    // The failure was before or during signing, so nothing was broadcast and
    // the held quote is still the one the user approved.
    void confirmAndCreate();
  }, [status, pendingRetry, replaySubmit, confirmAndCreate]);

  const reset = useCallback(() => {
    setStep("form");
    setFormValuesState(initialForm);
    setFeeOptionState("normal");
    setQuote(null);
    quotingRef.current = false;
    setQuoting(false);
    uploadingRef.current = false;
    setUploadingImage(false);
    setImageError(null);
    setSteps([]);
    setTotalSteps(null);
    setStatus("idle");
    setIsSubmitting(false);
    submittingRef.current = false;
    setResult(null);
    setError(null);
    setPendingRetry(null);
  }, []);

  const trackUrl =
    status === "success" && result?.txid
      ? mempoolTxUrl(network, kontorNetwork, result.txid)
      : null;

  return {
    step,
    formValues,
    setFormValues,
    addAttribute,
    updateAttribute,
    removeAttribute,
    attributesMap,
    canAddAttribute: formValues.attributes.length < MAX_CREATION_ATTRIBUTES,
    uploadImage,
    uploadingImage,
    imageError,
    clearImage,
    estimates,
    feeOption: effectiveFeeOption,
    setFeeOption,
    feeOptions,
    feeLabels: FEE_LABELS,
    feeRate,
    rateFor: (option) => rateForOption(option, estimates),
    btcUsd,
    fieldErrors,
    canQuote,
    advancedReadOnly: formValues.type === "ordinals",
    xcpFee,
    requestQuote,
    quoting,
    quote,
    costLines,
    confirmAndCreate,
    goBack,
    retry,
    reset,
    steps,
    totalSteps,
    status,
    isSubmitting,
    result,
    error,
    awaitingReplay,
    commitTxid,
    trackUrl,
  };
}
