// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCtx,
  renderHook,
  act,
  waitFor,
  type CtxRef,
} from "../hook-test-utils.js";
import { HorizonMarketApiError } from "../../api/http.js";
import { CreationNotBroadcastError } from "../../workflows/create.js";
import { useCreateToken } from "./useCreateToken.js";
import {
  MAX_CREATION_ATTRIBUTES,
  MAX_CREATION_DESCRIPTION_LENGTH,
  MAX_CREATION_NAME_LENGTH,
  type CreationQuote,
} from "../../api/creations.js";
import type { WorkflowProgressEvent } from "../../types/index.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

const QUOTE: CreationQuote = {
  type: "counterparty",
  identifier: "MYASSET",
  psbtBase64: "cHNidP8BAA==",
  inputsToSign: [0],
  revealTxHex: null,
  estimatedFeeSats: 1240,
  totalCostSats: 1240,
};

const CREATED = {
  type: "counterparty" as const,
  identifier: "MYASSET",
  txid: "a".repeat(64),
  revealTxid: null,
  inscriptionId: null,
  quote: QUOTE,
};

const SUBMIT_BODY = {
  type: "counterparty" as const,
  psbt: "70736274ff_signed",
  identifier: "MYASSET",
};

type CreateResult = ReturnType<typeof useCreateToken>;

/** The addresses `makeCtx` hands the hook. The first one funds every creation. */
const FUNDING_ADDRESS = "bc1qwallet";
const TAPROOT_ADDRESS = "bc1pwallet";

function xcpRow(address: string, quantity: bigint) {
  return {
    asset: "XCP",
    assetLongname: null,
    address,
    quantity,
    quantityNormalized: (Number(quantity) / 1e8).toFixed(8),
    divisible: true,
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    requestCreationQuote: vi.fn(async () => QUOTE),
    createToken: vi.fn(async () => CREATED),
    submitCreation: vi.fn(async () => CREATED),
    uploadCreationMedia: vi.fn(async () => ({
      ipfsUrl: "ipfs://bafyimage",
      cid: "bafyimage",
      thumbnailIpfsUrl: "ipfs://bafythumb",
      contentType: "image/png",
      size: 4096,
    })),
    // The funding address comfortably covers a named registration; the tests
    // that exercise the guard override this.
    getCounterpartyBalances: vi.fn(async () => [
      xcpRow(FUNDING_ADDRESS, 500_000_000n),
    ]),
    ...overrides,
  };
}

/** A form filled to the point where it could be quoted. */
function fillValid(result: { current: CreateResult }): void {
  act(() => {
    result.current.setFormValues({
      name: "MYASSET",
      image: "ipfs://bafyimage",
    });
  });
}

describe("useCreateToken", () => {
  beforeEach(() => {
    ctxRef.current = makeCtx({ client: makeClient() });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── The form ──────────────────────────────────────────────────────────────

  it("starts on the form, on Counterparty, with the documented defaults", () => {
    const { result } = renderHook(() => useCreateToken());

    expect(result.current.step).toBe("form");
    expect(result.current.formValues).toMatchObject({
      type: "counterparty",
      quantity: "1",
      divisible: false,
      lock: true,
      attributes: [],
    });
    expect(result.current.advancedReadOnly).toBe(false);
    expect(result.current.canQuote).toBe(false);
  });

  it("reports why the form cannot be quoted, field by field", () => {
    const { result } = renderHook(() => useCreateToken());

    expect(result.current.fieldErrors.name).toBeTypeOf("string");
    expect(result.current.fieldErrors.image).toBeTypeOf("string");

    act(() => result.current.setFormValues({ name: "abc" }));
    expect(result.current.fieldErrors.name).toBeTypeOf("string");

    fillValid(result);
    expect(result.current.fieldErrors).toEqual({});
    expect(result.current.canQuote).toBe(true);
  });

  it("pins quantity / divisible / lock the moment ordinals is chosen", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() =>
      result.current.setFormValues({
        quantity: "500",
        divisible: true,
        lock: false,
      }),
    );
    act(() => result.current.setFormValues({ type: "ordinals" }));

    expect(result.current.advancedReadOnly).toBe(true);
    expect(result.current.formValues).toMatchObject({
      quantity: "1",
      divisible: false,
      lock: true,
    });

    // Even a direct write cannot get around it — the rule lives in the hook, so
    // a custom UI gets it too.
    act(() => result.current.setFormValues({ quantity: "9", divisible: true }));
    expect(result.current.formValues.quantity).toBe("1");
    expect(result.current.formValues.divisible).toBe(false);
  });

  it("withholds the slow fee preset for ordinals — that reveal can't be bumped", () => {
    const { result } = renderHook(() => useCreateToken());

    expect(result.current.feeOptions).toEqual(["slow", "normal", "fast"]);

    act(() => result.current.setFeeOption("slow"));
    act(() => result.current.setFormValues({ type: "ordinals" }));

    expect(result.current.feeOptions).toEqual(["normal", "fast"]);
    expect(result.current.feeOption).toBe("normal");
    // Withheld from the presets, still quotable through `rateFor` — a custom UI
    // may want to show what it would have cost.
    expect(result.current.rateFor("slow")).toBe(result.current.rateFor("slow"));
  });

  it("caps an ordinal's name and every description by length", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() =>
      result.current.setFormValues({
        type: "ordinals",
        name: "x".repeat(MAX_CREATION_NAME_LENGTH + 1),
        image: "ipfs://bafyimage",
      }),
    );
    expect(result.current.fieldErrors.name).toMatch(/at most/);

    act(() =>
      result.current.setFormValues({
        name: "A fine inscription",
        description: "d".repeat(MAX_CREATION_DESCRIPTION_LENGTH + 1),
      }),
    );
    expect(result.current.fieldErrors.name).toBeUndefined();
    expect(result.current.fieldErrors.description).toMatch(/at most/);
    expect(result.current.canQuote).toBe(false);
  });

  // ─── Attribute rows ────────────────────────────────────────────────────────

  it("adds, edits and removes attribute rows", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.addAttribute());
    const id = result.current.formValues.attributes[0]?.id as string;
    act(() => result.current.updateAttribute(id, { key: " rarity ", value: " rare " }));

    // Trimmed on the way to the wire, untouched in the form.
    expect(result.current.attributesMap).toEqual({ rarity: "rare" });
    expect(result.current.formValues.attributes[0]?.key).toBe(" rarity ");

    act(() => result.current.removeAttribute(id));
    expect(result.current.formValues.attributes).toHaveLength(0);
  });

  it("stops adding rows at the documented cap", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => {
      for (let i = 0; i < MAX_CREATION_ATTRIBUTES + 3; i += 1) {
        result.current.addAttribute();
      }
    });

    expect(result.current.formValues.attributes).toHaveLength(
      MAX_CREATION_ATTRIBUTES,
    );
    expect(result.current.canAddAttribute).toBe(false);
  });

  it("drops a blank row rather than sending an empty key", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.addAttribute());
    expect(result.current.attributesMap).toEqual({});
    expect(result.current.fieldErrors.attributes).toBeUndefined();
  });

  it("reports a duplicate key instead of silently dropping a value", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => {
      result.current.addAttribute();
      result.current.addAttribute();
    });
    const [first, second] = result.current.formValues.attributes;
    act(() => {
      result.current.updateAttribute(first?.id as string, {
        key: "rarity",
        value: "rare",
      });
      result.current.updateAttribute(second?.id as string, {
        key: "rarity",
        value: "common",
      });
    });

    expect(result.current.fieldErrors.attributes).toMatch(/Duplicate/);
    expect(result.current.canQuote).toBe(false);
  });

  // ─── Media ─────────────────────────────────────────────────────────────────

  it("stores the pinned URIs and the local preview after an upload", async () => {
    const { result } = renderHook(() => useCreateToken());

    await act(async () => {
      await result.current.uploadImage(
        { uri: "file:///tmp/art.png", name: "art.png", type: "image/png" },
        "file:///tmp/art.png",
      );
    });

    expect(result.current.formValues.image).toBe("ipfs://bafyimage");
    expect(result.current.formValues.thumbnail).toBe("ipfs://bafythumb");
    expect(result.current.formValues.imagePreviewUri).toBe("file:///tmp/art.png");
    // Always pinned, so switching protocol later never forces a re-upload.
    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.uploadCreationMedia).toHaveBeenCalledWith(expect.anything(), {
      thumbnail: true,
    });
  });

  it("captures an upload failure in imageError rather than throwing", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        uploadCreationMedia: vi.fn(async () => {
          throw new HorizonMarketApiError(400, "File is larger than 10 MB.");
        }),
      }),
    });
    const { result } = renderHook(() => useCreateToken());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.uploadImage(new Blob(["x"]) as Blob);
    });

    expect(ok).toBe(false);
    expect(result.current.imageError).toMatch(/10 MB/);
    expect(result.current.formValues.image).toBeNull();
  });

  it("pins once however hard the picker is tapped", async () => {
    const client = makeClient({
      uploadCreationMedia: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ipfsUrl: "ipfs://bafyimage",
          cid: "bafyimage",
          thumbnailIpfsUrl: null,
          contentType: "image/png",
          size: 4096,
        };
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());

    let outcomes: boolean[] = [];
    await act(async () => {
      outcomes = await Promise.all([
        result.current.uploadImage(new Blob(["x"]) as Blob),
        result.current.uploadImage(new Blob(["x"]) as Blob),
      ]);
    });

    expect(client.uploadCreationMedia).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([true, false]);
  });

  it("says so rather than uploading into a client that does not exist", async () => {
    ctxRef.current = makeCtx({ client: null });
    const { result } = renderHook(() => useCreateToken());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.uploadImage(new Blob(["x"]) as Blob);
    });

    expect(ok).toBe(false);
    expect(result.current.imageError).toBeTypeOf("string");
  });

  it("clears a picked image back to nothing", async () => {
    const { result } = renderHook(() => useCreateToken());
    await act(async () => {
      await result.current.uploadImage(new Blob(["x"]) as Blob, "file:///a.png");
    });

    act(() => result.current.clearImage());

    expect(result.current.formValues).toMatchObject({
      image: null,
      thumbnail: null,
      imagePreviewUri: null,
    });
    expect(result.current.fieldErrors.image).toBeTypeOf("string");
  });

  // ─── Quote → confirm ───────────────────────────────────────────────────────

  it("quotes once and advances to confirm with the cost rows", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await act(async () => {
      await result.current.requestQuote();
    });

    expect(result.current.step).toBe("confirm");
    expect(result.current.quote).toEqual(QUOTE);
    expect(result.current.costLines.at(-1)).toMatchObject({
      key: "total",
      sats: 1240,
    });
  });

  it("quotes an ordinal against the wallet's taproot address", async () => {
    const client = makeClient({
      requestCreationQuote: vi.fn(async () => ({
        ...QUOTE,
        type: "ordinals" as const,
        identifier: "abc123i0",
        revealTxHex: "0200reveal",
        totalCostSats: 1786,
      })),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    act(() =>
      result.current.setFormValues({
        type: "ordinals",
        name: "My inscription",
        image: "ipfs://bafyimage",
      }),
    );

    await act(async () => {
      await result.current.requestQuote();
    });

    expect(client.requestCreationQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ordinals",
        address: "bc1qwallet",
        taprootAddress: "bc1pwallet",
      }),
    );
    // The postage gets its own row, so the fee and the total do not look wrong.
    expect(result.current.costLines.map((l) => l.key)).toEqual([
      "network",
      "postage",
      "total",
    ]);
  });

  it("refuses to quote or confirm without a client, an image or a wallet", async () => {
    ctxRef.current = makeCtx({ client: null });
    const { result } = renderHook(() => useCreateToken());

    await act(async () => {
      await result.current.requestQuote();
    });
    expect(result.current.error?.message).toMatch(/log in/);
    expect(result.current.step).toBe("form");

    // With a client but no image, the guard names the missing thing.
    ctxRef.current = makeCtx({ client: makeClient() });
    const { result: second } = renderHook(() => useCreateToken());
    act(() => second.current.setFormValues({ name: "MYASSET" }));
    await act(async () => {
      await second.current.requestQuote();
    });
    expect(second.current.error?.message).toMatch(/image/);

    // Confirming with nothing composed lands on the result step, not a throw.
    await act(async () => {
      await second.current.confirmAndCreate();
    });
    expect(second.current.step).toBe("result");
    expect(second.current.status).toBe("error");
    expect(second.current.error?.message).toMatch(/No quote to confirm/);

    // A client with no wallet behind it: there is no address to fund from.
    ctxRef.current = makeCtx({ client: makeClient(), addresses: null });
    const { result: third } = renderHook(() => useCreateToken());
    act(() =>
      third.current.setFormValues({
        name: "MYASSET",
        image: "ipfs://bafyimage",
      }),
    );
    await act(async () => {
      await third.current.requestQuote();
    });
    expect(third.current.error?.message).toMatch(/Connect a wallet/);
    expect(third.current.step).toBe("form");
  });

  it("lands a client that vanished mid-flow on the result step, not in a throw", async () => {
    const onError = vi.fn();
    const { result, rerender } = renderHook(() => useCreateToken({ onError }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });

    // A logout between Create and Confirm & sign.
    ctxRef.current = makeCtx({ client: null });
    act(() => rerender());
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    expect(result.current.step).toBe("result");
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/log in/);
    expect(onError).toHaveBeenCalled();
  });

  it("lands a client that vanished before the replay on the result step too", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        createToken: vi.fn(async () => {
          throw new CreationNotBroadcastError(SUBMIT_BODY, "c".repeat(64), null);
        }),
      }),
    });
    const { result, rerender } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    expect(result.current.commitTxid).not.toBeNull();

    ctxRef.current = makeCtx({ client: null });
    act(() => rerender());
    await act(async () => {
      result.current.retry();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/log in/);
    // Nothing was replayed, so the recovery is still waiting for a client.
    expect(result.current.commitTxid).not.toBeNull();
  });

  it("sends the whole filled form, and only the parts that were filled", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());

    // The functional setter form, which a custom UI may prefer.
    act(() =>
      result.current.setFormValues((prev) => ({
        ...prev,
        name: "MYASSET",
        description: "  A picture  ",
        image: "ipfs://bafyimage",
        thumbnail: "ipfs://bafythumb",
        quantity: "1000",
      })),
    );
    act(() => result.current.addAttribute());
    act(() =>
      result.current.updateAttribute(
        result.current.formValues.attributes[0]?.id as string,
        { key: "rarity", value: "rare" },
      ),
    );

    await act(async () => {
      await result.current.requestQuote();
    });

    expect(client.requestCreationQuote).toHaveBeenCalledWith({
      type: "counterparty",
      name: "MYASSET",
      description: "A picture",
      image: "ipfs://bafyimage",
      thumbnail: "ipfs://bafythumb",
      attributes: { rarity: "rare" },
      address: FUNDING_ADDRESS,
      options: {
        quantity: "1000",
        divisible: false,
        lock: true,
        feeRate: undefined,
      },
    });
  });

  it("reports an unusable supply before it costs a quote", () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    act(() => result.current.setFormValues({ quantity: "1.5" }));
    expect(result.current.fieldErrors.quantity).toMatch(/whole-number/);
    expect(result.current.canQuote).toBe(false);

    act(() => result.current.setFormValues({ divisible: true }));
    expect(result.current.fieldErrors.quantity).toBeUndefined();
  });

  it("quotes once however hard Create is pressed", async () => {
    const client = makeClient({
      requestCreationQuote: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return QUOTE;
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await act(async () => {
      await Promise.all([
        result.current.requestQuote(),
        result.current.requestQuote(),
      ]);
    });

    // A quote is metered — a second one would pin a second descriptor.
    expect(client.requestCreationQuote).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed quote on the form, with the message and no throw", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        requestCreationQuote: vi.fn(async () => {
          throw new HorizonMarketApiError(400, "Asset MYASSET already exists.");
        }),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await act(async () => {
      await result.current.requestQuote();
    });

    expect(result.current.step).toBe("form");
    expect(result.current.error?.message).toMatch(/already exists/);
    expect(result.current.quote).toBeNull();
  });

  it("drops the held quote on any edit, so nothing stale can be signed", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    expect(result.current.quote).not.toBeNull();

    act(() => result.current.setFormValues({ name: "OTHERASSET" }));
    expect(result.current.quote).toBeNull();

    // Same for the fee rate: it is part of what was composed.
    act(() => result.current.setFormValues({ name: "MYASSET" }));
    await act(async () => {
      await result.current.requestQuote();
    });
    act(() => result.current.setFeeOption("fast"));
    expect(result.current.quote).toBeNull();
  });

  // ─── Confirm → run ─────────────────────────────────────────────────────────

  it("hands the approved quote to createToken and reports success", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreateToken({ onSuccess }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    const [params] = (client.createToken as ReturnType<typeof vi.fn>).mock
      .calls[0] as [{ quote: CreationQuote }];
    // The same object, so the fees shown are the fees signed and no second
    // descriptor is pinned.
    expect(params.quote).toBe(result.current.quote);

    expect(result.current.step).toBe("result");
    expect(result.current.status).toBe("success");
    expect(result.current.trackUrl).toContain("a".repeat(64));
    expect(onSuccess).toHaveBeenCalledWith(CREATED);
  });

  it("collects the workflow's progress events and its step count", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        createToken: vi.fn(
          async (
            _params: unknown,
            options?: { onProgress?: (event: WorkflowProgressEvent) => void },
          ) => {
            options?.onProgress?.({
              workflow: "createToken",
              step: "signCreationPsbt",
              message: "Signing transaction…",
              stepIndex: 2,
              // The reporter emits events before it knows the total (the quote
              // step is skipped or not), so a null must not clobber a real one.
              totalSteps: null,
              phase: "start",
            });
            options?.onProgress?.({
              workflow: "createToken",
              step: "signCreationPsbt",
              message: "Transaction signed",
              stepIndex: 2,
              totalSteps: 3,
              phase: "complete",
            });
            return CREATED;
          },
        ),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    expect(result.current.steps.map((s) => s.phase)).toEqual([
      "start",
      "complete",
    ]);
    expect(result.current.totalSteps).toBe(3);
  });

  it("cannot be double-submitted by a double tap", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });

    await act(async () => {
      await Promise.all([
        result.current.confirmAndCreate(),
        result.current.confirmAndCreate(),
      ]);
    });

    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.createToken).toHaveBeenCalledTimes(1);
  });

  // ─── Recovery ──────────────────────────────────────────────────────────────

  it("retries a broadcast failure by replaying the SUBMIT ONLY", async () => {
    const txid = "c".repeat(64);
    const notBroadcast = new CreationNotBroadcastError(
      SUBMIT_BODY,
      txid,
      new HorizonMarketApiError(502, `broadcast as ${txid}`),
    );
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw notBroadcast;
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.commitTxid).toBe(txid);

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    // The whole point: re-running createToken would broadcast a SECOND
    // transaction and, for an ordinal, strand the first commit forever.
    expect(client.submitCreation).toHaveBeenCalledTimes(1);
    expect(client.submitCreation).toHaveBeenCalledWith(SUBMIT_BODY);
    expect(client.createToken).toHaveBeenCalledTimes(1);
    expect(result.current.commitTxid).toBeNull();
  });

  it("keeps replaying the same submit however often the replay fails", async () => {
    const txid = "c".repeat(64);
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, txid, null);
      }),
      submitCreation: vi.fn(async () => {
        throw new HorizonMarketApiError(502, "still rejected");
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.commitTxid).toBe(txid);

    // A second Retry must still replay: the plain 502 the first replay threw
    // carries no body of its own, and falling back to the workflow here would
    // compose and broadcast a second transaction.
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(client.submitCreation).toHaveBeenCalledTimes(2));
    expect(client.submitCreation).toHaveBeenLastCalledWith(SUBMIT_BODY);
    expect(client.createToken).toHaveBeenCalledTimes(1);
    expect(result.current.commitTxid).toBe(txid);
  });

  it("refuses to leave a broadcast transaction behind", async () => {
    const txid = "c".repeat(64);
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, txid, null);
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    expect(result.current.commitTxid).toBe(txid);

    // Going back would drop the body only the replay can use, and the next
    // Create would broadcast a SECOND transaction — for an ordinal, stranding
    // this one's funds forever. Retry is the only way out.
    act(() => result.current.goBack());

    expect(result.current.step).toBe("result");
    expect(result.current.commitTxid).toBe(txid);
    expect(result.current.error).toBeInstanceOf(CreationNotBroadcastError);

    // …and it still works from there.
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(client.submitCreation).toHaveBeenCalledTimes(1);
    expect(client.requestCreationQuote).toHaveBeenCalledTimes(1);
    // The replay reports the quote the broadcast transaction was composed from.
    expect(result.current.result?.quote).toEqual(QUOTE);
  });

  it("lets a submit failure that broadcast nothing go back and start over", async () => {
    const client = makeClient({
      createToken: vi.fn(async () => {
        // A 502 with no txid: the node was unreachable, nothing reached the
        // network, so re-composing costs a pin but strands nothing.
        throw new CreationNotBroadcastError(SUBMIT_BODY, null, null);
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    expect(result.current.commitTxid).toBeNull();

    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");
    expect(result.current.error).toBeNull();

    // The abandoned attempt goes with it: nothing left to retry, and no body
    // from a run the user walked away from waiting to be replayed.
    expect(result.current.status).toBe("idle");
    await act(async () => {
      result.current.retry();
    });
    expect(client.submitCreation).not.toHaveBeenCalled();
    expect(client.createToken).toHaveBeenCalledTimes(1);
  });

  it("retries a pre-broadcast failure by re-running with the same quote", async () => {
    let attempt = 0;
    const client = makeClient({
      createToken: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("wallet rejected the signature");
        return CREATED;
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.commitTxid).toBeNull();

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(client.createToken).toHaveBeenCalledTimes(2);
    expect(client.submitCreation).not.toHaveBeenCalled();
    // Still the one quote: a retry never re-composes.
    expect(client.requestCreationQuote).toHaveBeenCalledTimes(1);
  });

  // ─── The XCP name fee ──────────────────────────────────────────────────────

  it("clears a named issuance the funding address can pay for", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.sufficient).toBe(true));
    expect(result.current.xcpFee.requiredXcp).toBe(0.5);
    expect(result.current.xcpFee.balanceXcp).toBeCloseTo(5);
    expect(result.current.canQuote).toBe(true);
    expect(result.current.xcpFee.notice).toMatch(/0.5 XCP/);

    // Only the funding address is asked: it is the issuance's source, and the
    // one Counterparty debits the name fee from.
    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.getCounterpartyBalances).toHaveBeenCalledWith([
      FUNDING_ADDRESS,
    ]);
  });

  it("never blocks when no Counterparty API is configured", async () => {
    ctxRef.current = makeCtx({
      counterpartyApiBaseUrl: undefined,
      // What the real client answers without a base URL: nobody was asked.
      client: makeClient({ getCounterpartyBalances: vi.fn(async () => []) }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.checking).toBe(false));
    expect(result.current.xcpFee.requiredXcp).toBe(0.5);
    expect(result.current.xcpFee.sufficient).toBeNull();
    expect(result.current.canQuote).toBe(true);
  });

  it("never blocks when the balance read fails", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        getCounterpartyBalances: vi.fn(async () => {
          throw new Error("Counterparty API returned 503");
        }),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.checking).toBe(false));
    expect(result.current.xcpFee.sufficient).toBeNull();
    expect(result.current.canQuote).toBe(true);
  });

  it("blocks a named issuance the wallet positively cannot pay for", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        getCounterpartyBalances: vi.fn(async () => [
          xcpRow(FUNDING_ADDRESS, 10_000_000n), // 0.1 XCP
        ]),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.sufficient).toBe(false));
    expect(result.current.xcpFee.balanceXcp).toBeCloseTo(0.1);
    expect(result.current.canQuote).toBe(false);
  });

  it("blocks when a configured API reports no XCP row at all", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({ getCounterpartyBalances: vi.fn(async () => []) }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    // Someone WAS asked, so an empty answer is a real zero — not the "unknown"
    // an unconfigured client returns.
    await waitFor(() => expect(result.current.xcpFee.sufficient).toBe(false));
    expect(result.current.xcpFee.balanceXcp).toBe(0);
    expect(result.current.canQuote).toBe(false);
  });

  it("ignores XCP held anywhere but the funding address", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        // The real client is asked for one address, but a proxy or a cache could
        // answer with more; the fee is debited from the source address alone, so
        // a taproot balance must not count towards it.
        getCounterpartyBalances: vi.fn(async () => [
          xcpRow(TAPROOT_ADDRESS, 500_000_000n),
        ]),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.sufficient).toBe(false));
    expect(result.current.xcpFee.balanceXcp).toBe(0);
    expect(result.current.canQuote).toBe(false);
  });

  it("asks for no XCP at all on a numeric name", async () => {
    const { result } = renderHook(() => useCreateToken());
    act(() =>
      result.current.setFormValues({
        name: "A95428956661682177",
        image: "ipfs://bafyimage",
      }),
    );

    await waitFor(() => expect(result.current.xcpFee.checking).toBe(false));
    expect(result.current.xcpFee.requiredXcp).toBe(0);
    expect(result.current.xcpFee.notice).toBeNull();
    expect(result.current.canQuote).toBe(true);
    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.getCounterpartyBalances).not.toHaveBeenCalled();
  });

  // ─── Navigation ────────────────────────────────────────────────────────────

  it("goes back to the form from confirm, and from a failed result", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });

    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");
    // The name survives the round trip; only the quote is dropped.
    expect(result.current.formValues.name).toBe("MYASSET");
  });

  it("returns a failed run to the form with the error cleared", async () => {
    const onError = vi.fn();
    ctxRef.current = makeCtx({
      client: makeClient({
        createToken: vi.fn(async () => {
          throw new Error("wallet rejected the signature");
        }),
      }),
    });
    const { result } = renderHook(() => useCreateToken({ onError }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    expect(result.current.step).toBe("result");
    expect(onError).toHaveBeenCalled();

    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");
    expect(result.current.error).toBeNull();
  });

  it("ignores a retry when nothing has failed", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.retry());

    expect(result.current.step).toBe("form");
    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it("resets every field back to its initial value", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    act(() => result.current.addAttribute());
    await act(async () => {
      await result.current.requestQuote();
    });

    act(() => result.current.reset());

    expect(result.current.step).toBe("form");
    expect(result.current.quote).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.formValues).toMatchObject({
      type: "counterparty",
      name: "",
      image: null,
      quantity: "1",
      attributes: [],
    });
  });
});
