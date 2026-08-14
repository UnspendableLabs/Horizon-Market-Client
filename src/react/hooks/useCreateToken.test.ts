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
import {
  useCreateToken,
  type PersistedCreationRetry,
} from "./useCreateToken.js";
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

  it("reuses the held quote instead of pinning a second identical descriptor", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await act(async () => {
      await result.current.requestQuote();
    });
    act(() => result.current.goBack());
    expect(result.current.step).toBe("form");
    expect(result.current.quote).toEqual(QUOTE);

    // Back, then Create with nothing edited: the held quote was composed from
    // these exact values, and quoting again would orphan a pin per round trip.
    await act(async () => {
      await result.current.requestQuote();
    });
    expect(result.current.step).toBe("confirm");
    expect(client.requestCreationQuote).toHaveBeenCalledTimes(1);

    // An edit drops it, and only then is a fresh quote taken.
    act(() => result.current.setFormValues({ name: "OTHERASSET" }));
    expect(result.current.quote).toBeNull();
    await act(async () => {
      await result.current.requestQuote();
    });
    expect(client.requestCreationQuote).toHaveBeenCalledTimes(2);
  });

  it("will not spend a metered quote on values it already knows are invalid", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    // Lowercase is not a Counterparty asset name. The form disables Create, but
    // the guard lives here so a custom UI cannot pin a descriptor the server is
    // certain to reject.
    act(() => result.current.setFormValues({ name: "not a name" }));
    expect(result.current.canQuote).toBe(false);

    await act(async () => {
      await result.current.requestQuote();
    });

    expect(client.requestCreationQuote).not.toHaveBeenCalled();
    expect(result.current.step).toBe("form");
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

  it("refuses to leave a 502 that named no txid, either", async () => {
    const client = makeClient({
      createToken: vi.fn(async () => {
        // Read literally this is the node-unreachable branch — but that reading
        // is a regex over prose, and the cost of being wrong is an ordinal's
        // commit stranded forever. Held for replay like any other 502.
        throw new CreationNotBroadcastError(
          SUBMIT_BODY,
          null,
          new HorizonMarketApiError(502, "Bitcoin node unreachable."),
        );
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

    // Nothing to display, but everything to protect.
    expect(result.current.commitTxid).toBeNull();
    expect(result.current.awaitingReplay).toBe(true);

    act(() => result.current.goBack());
    expect(result.current.step).toBe("result");

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(client.submitCreation).toHaveBeenCalledWith(SUBMIT_BODY);
    expect(client.createToken).toHaveBeenCalledTimes(1);
  });

  it("lets a submit the server positively rejected go back and start over", async () => {
    const client = makeClient({
      createToken: vi.fn(async () => {
        // A 400: the server validates the PSBT, the reveal and their binding
        // before it touches a node, so re-composing costs a pin and strands
        // nothing.
        throw new CreationNotBroadcastError(
          SUBMIT_BODY,
          null,
          new HorizonMarketApiError(400, "psbt could not be finalised."),
        );
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
    expect(result.current.awaitingReplay).toBe(false);

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

  it("says nothing about XCP, and asks nobody, before a name is typed", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());

    // An untouched form used to price the empty name as a 0.5 XCP named
    // registration: a notice, a balance read, and — on a wallet holding no XCP
    // — a red "you cannot afford this" over a name that does not exist yet.
    expect(result.current.xcpFee.requiredXcp).toBe(0);
    expect(result.current.xcpFee.notice).toBeNull();
    expect(result.current.xcpFee.sufficient).toBe(true);

    // Past the debounce window, so this is "nobody was asked", not "not yet".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(client.getCounterpartyBalances).not.toHaveBeenCalled();
  });

  it("stays quiet while the name is still invalid", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.setFormValues({ name: "lowercase" }));

    expect(result.current.fieldErrors.name).toBeTruthy();
    expect(result.current.xcpFee.notice).toBeNull();
  });

  it("prices the name only once it is one, and frees a generated one", async () => {
    const { result } = renderHook(() => useCreateToken());

    fillValid(result);
    await waitFor(() => expect(result.current.xcpFee.requiredXcp).toBe(0.5));
    expect(result.current.xcpFee.notice).toMatch(/0.5 XCP/);

    // The generator's whole purpose: a name that costs nothing, so the notice
    // and the balance guard go away with it.
    act(() => result.current.generateName());

    expect(result.current.formValues.name).toMatch(/^A\d+$/);
    expect(result.current.fieldErrors.name).toBeUndefined();
    expect(result.current.xcpFee.requiredXcp).toBe(0);
    expect(result.current.xcpFee.notice).toBeNull();
    expect(result.current.canGenerateName).toBe(true);
  });

  it("drops a held quote when the name is generated", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    expect(result.current.quote).not.toBeNull();

    act(() => result.current.generateName());

    // A generated name is an edit like any other: signing the old quote would
    // issue the name the user just replaced.
    expect(result.current.quote).toBeNull();
    expect(result.current.formValues.name).toMatch(/^A\d+$/);
  });

  it("withdraws the generator under Ordinals, which has no asset names", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.setFormValues({ type: "ordinals" }));

    expect(result.current.canGenerateName).toBe(false);
  });

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

  it("settles the balance before quoting, not on the debounce's schedule", async () => {
    const client = makeClient({
      getCounterpartyBalances: vi.fn(async () => [
        xcpRow(FUNDING_ADDRESS, 10_000_000n), // 0.1 XCP against a 0.5 fee
      ]),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    // Straight to Create, inside the debounce window: the live check has not
    // answered yet, so `sufficient` is still the permissive `null`.
    expect(result.current.xcpFee.sufficient).toBeNull();
    expect(result.current.canQuote).toBe(true);

    await act(async () => {
      await result.current.requestQuote();
    });

    // Resolved on the spot rather than waved through — the whole point of the
    // guard is not to spend a pin on a creation that cannot pay its name fee.
    expect(client.requestCreationQuote).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/0\.5 XCP/);
    expect(result.current.step).toBe("form");
  });

  it("still quotes when the balance covers the fee, without waiting on the timer", async () => {
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    expect(result.current.xcpFee.sufficient).toBeNull();
    await act(async () => {
      await result.current.requestQuote();
    });

    expect(client.requestCreationQuote).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe("confirm");
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

  // ─── Surviving a restart ───────────────────────────────────────────────────
  //
  // Refusing `goBack()` keeps the signed body away from the user; a store keeps
  // it away from the process. Without one, an OS kill loses the only thing that
  // can finish a broadcast creation — for an ordinal, permanently.

  function makeStore(initial: unknown = null) {
    const held = { current: initial as never };
    return {
      current: held,
      load: vi.fn(async () => held.current),
      save: vi.fn(async (retry: never) => {
        held.current = retry;
      }),
      clear: vi.fn(async () => {
        held.current = null as never;
      }),
    };
  }

  it("writes a possibly-broadcast submit down, and takes it back on success", async () => {
    const store = makeStore();
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, "c".repeat(64), null);
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    await waitFor(() => expect(store.save).toHaveBeenCalled());
    expect(store.current.current).toMatchObject({
      submit: SUBMIT_BODY,
      quote: QUOTE,
      possiblyBroadcast: true,
    });

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    // Nothing left to recover, so nothing left lying around to be restored.
    await waitFor(() => expect(store.current.current).toBeNull());
  });

  it("keeps nothing for a submit the server positively rejected", async () => {
    const store = makeStore();
    ctxRef.current = makeCtx({
      client: makeClient({
        createToken: vi.fn(async () => {
          throw new CreationNotBroadcastError(
            SUBMIT_BODY,
            null,
            new HorizonMarketApiError(400, "psbt could not be finalised."),
          );
        }),
      }),
    });
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });

    // Nothing was broadcast, so re-composing costs a pin and strands nothing —
    // not worth outliving the session.
    await waitFor(() => expect(result.current.awaitingReplay).toBe(false));
    expect(store.save).not.toHaveBeenCalled();
    expect(store.current.current).toBeNull();
  });

  it("restores a held recovery onto the failed step, ready to replay", async () => {
    const store = makeStore({
      submit: SUBMIT_BODY,
      commitTxid: "c".repeat(64),
      possiblyBroadcast: true,
      quote: QUOTE,
    });
    const client = makeClient();
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));

    await waitFor(() => expect(result.current.awaitingReplay).toBe(true));
    expect(result.current.step).toBe("result");
    expect(result.current.status).toBe("error");
    expect(result.current.commitTxid).toBe("c".repeat(64));
    expect(result.current.error?.message).toMatch(/earlier session/);

    // And it finishes the job the dead process could not.
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(client.submitCreation).toHaveBeenCalledWith(SUBMIT_BODY);
    expect(client.createToken).not.toHaveBeenCalled();
    expect(result.current.result?.quote).toEqual(QUOTE);
  });

  it("reads a store it has just been handed before it writes to it", async () => {
    const first = makeStore();
    // What the second store holds: a stranded creation belonging to the wallet
    // or network the screen is switching to.
    const second = makeStore({
      submit: SUBMIT_BODY,
      commitTxid: "c".repeat(64),
      possiblyBroadcast: true,
      quote: QUOTE,
    });
    const { result, rerender } = renderHook(
      ({ store }) => useCreateToken({ retryStore: store }),
      { initialProps: { store: first } },
    );
    await waitFor(() => expect(first.load).toHaveBeenCalled());

    rerender({ store: second });

    // A new store is a new key. Carrying the previous one's "loaded" across
    // would fire the mirror against a `pendingRetry` of null the instant the
    // store changed — a clear() on a body nobody has read yet.
    await waitFor(() => expect(result.current.awaitingReplay).toBe(true));
    expect(second.clear).not.toHaveBeenCalled();
    expect(second.current.current).not.toBeNull();
  });

  it("leaves a recovery it declined to restore on disk rather than erasing it", async () => {
    let answer!: (held: PersistedCreationRetry | null) => void;
    const store = {
      load: vi.fn(
        () =>
          new Promise<PersistedCreationRetry | null>((resolve) => {
            answer = resolve;
          }),
      ),
      save: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));

    // The user reaches the confirm sheet before the store gets around to
    // answering — the one case where a restore would overwrite a live run.
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    expect(result.current.step).toBe("confirm");

    await act(async () => {
      answer({
        submit: SUBMIT_BODY,
        commitTxid: "c".repeat(64),
        possiblyBroadcast: true,
        quote: QUOTE,
      });
    });

    // Not restored, because the newer run wins — and not cleared either, because
    // it is still the only copy of a creation nobody ever finished. The next
    // mount that lands on an untouched form is the one that gets to offer it.
    expect(result.current.step).toBe("confirm");
    expect(result.current.awaitingReplay).toBe(false);
    expect(store.clear).not.toHaveBeenCalled();
  });

  it("survives a store that cannot be read", async () => {
    const store = {
      load: vi.fn(async () => {
        throw new Error("AsyncStorage unavailable");
      }),
      save: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));

    await waitFor(() => expect(store.load).toHaveBeenCalled());
    expect(result.current.step).toBe("form");
    expect(result.current.error).toBeNull();
  });

  // ─── The way out of a replay that will not go through ──────────────────────

  it("refuses to abandon a replay that has not even been tried", async () => {
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, "c".repeat(64), null);
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

    expect(result.current.canAbandonReplay).toBe(false);
    act(() => result.current.abandonReplay());

    // Retry is still the right answer, and dropping the body is irreversible.
    expect(result.current.step).toBe("result");
    expect(result.current.awaitingReplay).toBe(true);
  });

  it("opens the escape hatch once a replay has failed, and hands over the body", async () => {
    const store = makeStore();
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, "c".repeat(64), null);
      }),
      submitCreation: vi.fn(async () => {
        // What a node says about a transaction that is already mined — the
        // 4xx that would otherwise lock the screen forever.
        throw new HorizonMarketApiError(
          400,
          "Transaction already in block chain",
        );
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));
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
    await waitFor(() => expect(result.current.replayAttempts).toBe(1));

    expect(result.current.replayRejected).toBe(true);
    expect(result.current.canAbandonReplay).toBe(true);
    // The one thing that can finish the creation, in a form that can leave the
    // device before the user gives up on it.
    expect(result.current.pendingSubmitJson).toContain(SUBMIT_BODY.psbt);

    act(() => result.current.abandonReplay());

    expect(result.current.step).toBe("form");
    expect(result.current.status).toBe("idle");
    expect(result.current.awaitingReplay).toBe(false);
    expect(result.current.pendingSubmitJson).toBeNull();
    // Walking away means walking away: nothing waits to be restored next time.
    await waitFor(() => expect(store.current.current).toBeNull());
  });

  it("ignores a retry when nothing has failed", () => {
    const { result } = renderHook(() => useCreateToken());

    act(() => result.current.retry());

    expect(result.current.step).toBe("form");
    const client = ctxRef.current?.client as unknown as ReturnType<typeof makeClient>;
    expect(client.createToken).not.toHaveBeenCalled();
  });

  it("refuses to reset away a recovery only a replay can finish", async () => {
    const store = makeStore();
    const client = makeClient({
      createToken: vi.fn(async () => {
        throw new CreationNotBroadcastError(SUBMIT_BODY, "c".repeat(64), null);
      }),
    });
    ctxRef.current = makeCtx({ client });
    const { result } = renderHook(() => useCreateToken({ retryStore: store }));
    fillValid(result);
    await act(async () => {
      await result.current.requestQuote();
    });
    await act(async () => {
      await result.current.confirmAndCreate();
    });
    await waitFor(() => expect(store.current.current).not.toBeNull());
    // The mount's own mirror already cleared an empty store once; what matters
    // is that nothing clears it again from here.
    const clearsBefore = store.clear.mock.calls.length;

    act(() => result.current.reset());

    // `goBack()` already refuses here; reset would otherwise be the way around
    // it, and the worse one — it clears the store as well as the state, which is
    // the permanently stranded commit the whole design exists to prevent.
    expect(result.current.step).toBe("result");
    expect(result.current.awaitingReplay).toBe(true);
    expect(result.current.pendingSubmitJson).toContain(SUBMIT_BODY.psbt);
    expect(store.clear.mock.calls.length).toBe(clearsBefore);
    expect(store.current.current).not.toBeNull();
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
