import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHorizonMarket } from "../context.js";
import { usePrices } from "./usePrices.js";
import { useFeeEstimates, type FeeEstimates } from "./useFeeEstimates.js";
import { CLIENT_NOT_INITIALIZED, mempoolTxUrl } from "../internal/format.js";
import { FEE_LABELS, rateForOption, type FeeOption } from "../internal/feeRate.js";
import {
  creationCostLines,
  xcpFeeNotice,
  type CreationCostLine,
} from "../internal/creationCost.js";
import { stepMessages } from "../../workflows/progress.js";
import {
  creationRetry,
  type CreateTokenParams,
  type CreateTokenResult,
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
 */
export interface CreateTokenXcpFee {
  requiredXcp: number;
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
   * Set when the transaction is on-chain but the server did not confirm the
   * creation — `retry()` then re-sends the same signed transaction rather than
   * composing a new one.
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
  const { client, addresses, network, kontorNetwork } = useHorizonMarket();
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
  const [commitTxid, setCommitTxid] = useState<string | null>(null);
  const [xcpBalance, setXcpBalance] = useState<number | null>(null);
  const [xcpChecking, setXcpChecking] = useState(false);

  const submittingRef = useRef(false);

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

  // Read the balance only once there is a fee to cover, and debounce it: the
  // name is typed a character at a time, and this is a live upstream read.
  useEffect(() => {
    if (!client || !addresses || requiredXcp <= 0) {
      setXcpBalance(null);
      setXcpChecking(false);
      return;
    }
    let cancelled = false;
    setXcpChecking(true);
    const timer = setTimeout(() => {
      const held = [addresses.p2wpkh, addresses.p2tr].filter(
        (address): address is string => Boolean(address),
      );
      void client
        .getCounterpartyBalances(held)
        .then((balances) => {
          if (cancelled) return;
          const xcp = balances.find((row) => row.asset === "XCP");
          // No XCP row is a real zero; an unconfigured API answers [] and is
          // handled by the empty-array check below.
          setXcpBalance(
            balances.length === 0
              ? null
              : Number(xcp?.quantity ?? 0n) / XCP_UNIT,
          );
        })
        .catch(() => {
          // An unreadable balance is not a reason to refuse — see the docblock
          // on CreateTokenXcpFee.
          if (!cancelled) setXcpBalance(null);
        })
        .finally(() => {
          if (!cancelled) setXcpChecking(false);
        });
    }, XCP_BALANCE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, addresses, requiredXcp]);

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
      if (!client) {
        setImageError(CLIENT_NOT_INITIALIZED);
        return false;
      }
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
    if (quoting) return;
    if (!client) {
      setError(new Error(CLIENT_NOT_INITIALIZED));
      return;
    }
    if (!addresses) {
      setError(new Error("Connect a wallet to create a token."));
      return;
    }
    if (!formValues.image) {
      setError(new Error("Add an image before creating."));
      return;
    }
    setQuoting(true);
    setError(null);
    try {
      const params = buildParams(formValues.image);
      const address = addresses.p2wpkh;
      const composed = await client.requestCreationQuote(
        params.type === "counterparty"
          ? {
              type: "counterparty",
              name: params.name,
              description: params.description,
              image: params.image,
              thumbnail: params.thumbnail,
              attributes: params.attributes,
              address,
              options: { ...params.options, feeRate: params.satsPerVbyte },
            }
          : {
              type: "ordinals",
              name: params.name,
              description: params.description,
              image: params.image,
              attributes: params.attributes,
              address,
              taprootAddress: addresses.p2tr,
              options: { feeRate: params.satsPerVbyte },
            },
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
      setQuoting(false);
    }
  }, [client, addresses, buildParams, quoting, formValues.image]);

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
      setCommitTxid(null);
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
        setCommitTxid(creationRetry(e)?.commitTxid ?? null);
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
    async (retryParams: NonNullable<ReturnType<typeof creationRetry>>) => {
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
          const full: CreateTokenResult = {
            ...created,
            quote: quote as CreationQuote,
          };
          setResult(full);
          setStatus("success");
          setStep("result");
          setCommitTxid(null);
          optsRef.current?.onSuccess?.(full);
        } catch (err) {
          emit("error");
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          setStatus("error");
          setStep("result");
          // Keep the commit txid: the transaction is still on-chain, so the
          // replay is still the only safe recovery. A plain API error from the
          // retry carries no such body, so it must not overwrite this.
          optsRef.current?.onError?.(e);
        }
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [client, quote, totalSteps],
  );

  const goBack = useCallback(() => {
    if (step === "confirm") {
      setStep("form");
    } else if (step === "result" && status === "error") {
      setError(null);
      setStep("form");
    }
  }, [step, status]);

  const retry = useCallback(() => {
    if (status !== "error") return;
    const recovery = creationRetry(error);
    if (recovery) {
      void replaySubmit(recovery);
      return;
    }
    // The failure was before or during signing, so nothing was broadcast and
    // the held quote is still the one the user approved.
    void confirmAndCreate();
  }, [status, error, replaySubmit, confirmAndCreate]);

  const reset = useCallback(() => {
    setStep("form");
    setFormValuesState(initialForm);
    setFeeOptionState("normal");
    setQuote(null);
    setQuoting(false);
    setUploadingImage(false);
    setImageError(null);
    setSteps([]);
    setTotalSteps(null);
    setStatus("idle");
    setIsSubmitting(false);
    submittingRef.current = false;
    setResult(null);
    setError(null);
    setCommitTxid(null);
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
    commitTxid,
    trackUrl,
  };
}
