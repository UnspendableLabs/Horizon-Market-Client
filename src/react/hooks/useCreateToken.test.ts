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
import type { CreationQuote } from "../../api/creations.js";

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
    // No Counterparty API configured for the test network — the balance is
    // unknown, which must never block.
    getCounterpartyBalances: vi.fn(async () => []),
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

  it("keeps the commit txid when the replay fails again", async () => {
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

  it("never blocks on an unreadable XCP balance", async () => {
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.checking).toBe(false));
    expect(result.current.xcpFee.requiredXcp).toBe(0.5);
    expect(result.current.xcpFee.sufficient).toBeNull();
    expect(result.current.canQuote).toBe(true);
    expect(result.current.xcpFee.notice).toMatch(/0.5 XCP/);
  });

  it("blocks a named issuance the wallet positively cannot pay for", async () => {
    ctxRef.current = makeCtx({
      client: makeClient({
        getCounterpartyBalances: vi.fn(async () => [
          {
            asset: "XCP",
            assetLongname: null,
            address: "bc1qwallet",
            quantity: 10_000_000n, // 0.1 XCP
            quantityNormalized: "0.10000000",
            divisible: true,
          },
        ]),
      }),
    });
    const { result } = renderHook(() => useCreateToken());
    fillValid(result);

    await waitFor(() => expect(result.current.xcpFee.sufficient).toBe(false));
    expect(result.current.xcpFee.balanceXcp).toBeCloseTo(0.1);
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
