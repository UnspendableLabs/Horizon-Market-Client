import { describe, it, expect, vi } from "vitest";
import { HttpClient, HorizonMarketApiError } from "./http.js";
import {
  commitTxidFromCreationError,
  creationSubmitMayHaveBroadcast,
  requestCreationQuote,
  submitCreation,
  uploadCreationMedia,
} from "./creations.js";
import { makeFetch } from "../test-utils.js";

const WIRE_QUOTE = {
  type: "counterparty",
  identifier: "MYASSET",
  psbt: "cHNidP8BAA==",
  inputs_to_sign: [0, 1],
  reveal_tx_hex: null,
  estimated_fee_sats: 1240,
  total_cost_sats: 1240,
};

const WIRE_RESULT = {
  type: "ordinals",
  identifier: "abc123i0",
  txid: "a".repeat(64),
  reveal_txid: "b".repeat(64),
  inscription_id: "abc123i0",
};

const WIRE_MEDIA = {
  ipfs_url: "ipfs://bafyimage",
  cid: "bafyimage",
  thumbnail_ipfs_url: "ipfs://bafythumb",
  content_type: "image/png",
  size: 4096,
};

function http(fetchFn: typeof globalThis.fetch): HttpClient {
  return new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
}

function lastCall(fetchFn: typeof globalThis.fetch): [string, RequestInit] {
  const mock = fetchFn as ReturnType<typeof vi.fn>;
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
}

function bodyOf(fetchFn: typeof globalThis.fetch): Record<string, unknown> {
  const [, init] = lastCall(fetchFn);
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

/** A raw (non-enveloped) response with real Headers — for the `fetchRaw` path. */
function rawResponse(
  status: number,
  init: { json?: unknown; statusText?: string } = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: init.statusText ?? "OK",
    headers: new Headers(),
    json: () =>
      init.json === undefined
        ? Promise.reject(new Error("not json"))
        : Promise.resolve(init.json),
  } as unknown as Response;
}

function makeRawFetch(response: Response): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(response);
}

// ─── requestCreationQuote ────────────────────────────────────────────────────

describe("requestCreationQuote", () => {
  it("posts the minimal body and maps the response", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_QUOTE });

    const quote = await requestCreationQuote(http(fetchFn), {
      type: "counterparty",
      name: "MYASSET",
      image: "ipfs://bafyimage",
      address: "bc1qfunding",
    });

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/creations/quotes");
    expect(init.method).toBe("POST");
    expect(bodyOf(fetchFn)).toEqual({
      type: "counterparty",
      name: "MYASSET",
      image: "ipfs://bafyimage",
      address: "bc1qfunding",
    });

    expect(quote).toEqual({
      type: "counterparty",
      identifier: "MYASSET",
      psbtBase64: "cHNidP8BAA==",
      inputsToSign: [0, 1],
      revealTxHex: null,
      estimatedFeeSats: 1240,
      totalCostSats: 1240,
    });
  });

  it("omits every optional key rather than sending undefined", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_QUOTE });

    await requestCreationQuote(http(fetchFn), {
      type: "counterparty",
      name: "MYASSET",
      image: "ipfs://bafyimage",
      address: "bc1qfunding",
    });

    const body = bodyOf(fetchFn);
    expect("thumbnail" in body).toBe(false);
    expect("description" in body).toBe(false);
    expect("attributes" in body).toBe(false);
    expect("taproot_address" in body).toBe(false);
    expect("public_key" in body).toBe(false);
    // Every option is server-defaulted, so an untouched advanced section sends
    // no `options` at all.
    expect("options" in body).toBe(false);
  });

  it("nests fee_rate inside options and writes `lock`, not `locked`", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_QUOTE });

    await requestCreationQuote(http(fetchFn), {
      type: "counterparty",
      name: "MYASSET",
      image: "ipfs://bafyimage",
      address: "bc1qfunding",
      options: { quantity: "1000", divisible: true, lock: false, feeRate: 7 },
    });

    const body = bodyOf(fetchFn);
    expect(body.options).toEqual({
      quantity: "1000",
      divisible: true,
      lock: false,
      fee_rate: 7,
    });
    expect("fee_rate" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain("locked");
  });

  it("passes the supply through unscaled — the server does the 1e8", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_QUOTE });

    await requestCreationQuote(http(fetchFn), {
      type: "counterparty",
      name: "MYASSET",
      image: "ipfs://bafyimage",
      address: "bc1qfunding",
      options: { quantity: 2.5, divisible: true },
    });

    expect(bodyOf(fetchFn).options).toEqual({ quantity: 2.5, divisible: true });
  });

  it("sends the ordinals fields and keeps a non-null reveal", async () => {
    const fetchFn = makeFetch(200, {
      data: { ...WIRE_QUOTE, type: "ordinals", reveal_tx_hex: "0200reveal" },
    });

    const quote = await requestCreationQuote(http(fetchFn), {
      type: "ordinals",
      name: "My inscription",
      description: "A picture",
      image: "ipfs://bafyimage",
      attributes: { rarity: "rare" },
      address: "bc1qfunding",
      taprootAddress: "bc1preceiver",
      options: { feeRate: 12 },
    });

    expect(bodyOf(fetchFn)).toEqual({
      type: "ordinals",
      name: "My inscription",
      description: "A picture",
      image: "ipfs://bafyimage",
      attributes: { rarity: "rare" },
      address: "bc1qfunding",
      taproot_address: "bc1preceiver",
      options: { fee_rate: 12 },
    });
    expect(quote.revealTxHex).toBe("0200reveal");
  });

  it("raises the server's message on a 401", async () => {
    const fetchFn = makeFetch(401, { error: "Authentication required." });

    await expect(
      requestCreationQuote(http(fetchFn), {
        type: "counterparty",
        name: "MYASSET",
        image: "ipfs://bafyimage",
        address: "bc1qfunding",
      }),
    ).rejects.toThrow("Authentication required.");
  });
});

// ─── submitCreation ──────────────────────────────────────────────────────────

describe("submitCreation", () => {
  it("sends the signed psbt with the reveal echoed verbatim, and maps the 201", async () => {
    const fetchFn = makeFetch(201, { data: WIRE_RESULT });

    const result = await submitCreation(http(fetchFn), {
      type: "ordinals",
      psbt: "70736274ff_signed",
      revealTxHex: "0200reveal",
      identifier: "abc123i0",
    });

    const [url] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/creations");
    expect(bodyOf(fetchFn)).toEqual({
      type: "ordinals",
      psbt: "70736274ff_signed",
      reveal_tx_hex: "0200reveal",
      identifier: "abc123i0",
    });
    expect(result).toEqual({
      type: "ordinals",
      identifier: "abc123i0",
      txid: "a".repeat(64),
      revealTxid: "b".repeat(64),
      inscriptionId: "abc123i0",
    });
  });

  it("sends tx_hex alone when that is what the caller has", async () => {
    const fetchFn = makeFetch(201, { data: { ...WIRE_RESULT, type: "counterparty" } });

    await submitCreation(http(fetchFn), {
      type: "counterparty",
      txHex: "0200finalized",
    });

    const body = bodyOf(fetchFn);
    expect(body).toEqual({ type: "counterparty", tx_hex: "0200finalized" });
    expect("psbt" in body).toBe(false);
  });
});

describe("commitTxidFromCreationError", () => {
  const txid = "c".repeat(64);

  it("reads the commit txid out of a 502", () => {
    const error = new HorizonMarketApiError(
      502,
      `The commit was broadcast as ${txid.toUpperCase()}, but its reveal was rejected.`,
    );
    expect(commitTxidFromCreationError(error)).toBe(txid);
  });

  it("answers null for a 502 that names no txid", () => {
    const error = new HorizonMarketApiError(502, "Bitcoin node unreachable.");
    expect(commitTxidFromCreationError(error)).toBeNull();
  });

  it("answers null for a 400 and for anything that is not an API error", () => {
    expect(
      commitTxidFromCreationError(new HorizonMarketApiError(400, txid)),
    ).toBeNull();
    expect(commitTxidFromCreationError(new Error(txid))).toBeNull();
    expect(commitTxidFromCreationError(null)).toBeNull();
  });
});

describe("creationSubmitMayHaveBroadcast", () => {
  const txid = "c".repeat(64);

  it("clears only a 4xx — the server rejects before it touches a node", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 499]) {
      expect(
        creationSubmitMayHaveBroadcast(
          new HorizonMarketApiError(status, "rejected"),
        ),
      ).toBe(false);
    }
  });

  it("holds a 502 whether or not it names a txid", () => {
    // The txid-less branch is the one that matters: read literally it means the
    // node was unreachable, but that reading rests on the wording of a prose
    // message, and being wrong strands an ordinal's commit forever.
    expect(
      creationSubmitMayHaveBroadcast(
        new HorizonMarketApiError(502, "Bitcoin node unreachable."),
      ),
    ).toBe(true);
    expect(
      creationSubmitMayHaveBroadcast(
        new HorizonMarketApiError(502, `broadcast as ${txid}`),
      ),
    ).toBe(true);
  });

  it("holds anything that never produced a status at all", () => {
    // A socket closed mid-flight: the POST may well have been served.
    expect(creationSubmitMayHaveBroadcast(new TypeError("network error"))).toBe(
      true,
    );
    expect(creationSubmitMayHaveBroadcast(null)).toBe(true);
  });
});

// ─── uploadCreationMedia ─────────────────────────────────────────────────────

describe("uploadCreationMedia", () => {
  it("posts multipart under the `file` field and never sets Content-Type", async () => {
    const fetchFn = makeRawFetch(rawResponse(201, { json: { data: WIRE_MEDIA } }));

    const media = await uploadCreationMedia(
      http(fetchFn),
      new File([new Uint8Array([1, 2, 3])], "art.png", { type: "image/png" }),
    );

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe("https://example.com/api/creations/media");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("art.png");
    // `fetch` fills in the multipart boundary; setting the header would break it.
    expect((init.headers as Headers).get("Content-Type")).toBeNull();

    expect(media).toEqual({
      ipfsUrl: "ipfs://bafyimage",
      cid: "bafyimage",
      thumbnailIpfsUrl: "ipfs://bafythumb",
      contentType: "image/png",
      size: 4096,
    });
  });

  it("appends ?thumbnail=true only when asked", async () => {
    const fetchFn = makeRawFetch(rawResponse(201, { json: { data: WIRE_MEDIA } }));

    await uploadCreationMedia(http(fetchFn), new Blob([new Uint8Array([1])]), {
      thumbnail: true,
    });

    expect(lastCall(fetchFn)[0]).toBe(
      "https://example.com/api/creations/media?thumbnail=true",
    );
  });

  it("accepts a React Native picker descriptor", async () => {
    const fetchFn = makeRawFetch(rawResponse(201, { json: { data: WIRE_MEDIA } }));

    await uploadCreationMedia(http(fetchFn), {
      uri: "file:///tmp/art.jpg",
      name: "art.jpg",
      type: "image/jpeg",
    });

    // Node's FormData stringifies a non-Blob value; asserting on that proves the
    // descriptor (not a Blob) is what got appended — which is what RN's fetch
    // needs to stream the file off disk.
    const form = lastCall(fetchFn)[1].body as FormData;
    expect(String(form.get("file"))).toContain("[object Object]");
  });

  it("defaults name and type for a bare RN uri", async () => {
    const fetchFn = makeRawFetch(rawResponse(201, { json: { data: WIRE_MEDIA } }));

    await expect(
      uploadCreationMedia(http(fetchFn), { uri: "file:///tmp/art" }),
    ).resolves.toMatchObject({ ipfsUrl: "ipfs://bafyimage" });
  });

  it("preserves a null thumbnail", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(201, {
        json: { data: { ...WIRE_MEDIA, thumbnail_ipfs_url: null } },
      }),
    );

    const media = await uploadCreationMedia(http(fetchFn), new Blob(["x"]));
    expect(media.thumbnailIpfsUrl).toBeNull();
  });

  it("raises the server's message on a rejected upload", async () => {
    const fetchFn = makeRawFetch(
      rawResponse(400, { json: { error: "File is larger than 10 MB." } }),
    );

    await expect(
      uploadCreationMedia(http(fetchFn), new Blob(["x"])),
    ).rejects.toThrow("File is larger than 10 MB.");
  });
});
