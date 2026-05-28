import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "../api/http.js";
import { fillSwaps } from "./buy.js";
import { makeSequentialFetch, makeSigner } from "../test-utils.js";

const WIRE_BUY_QUOTE = {
  psbt: "70736274ff_buy",
  inputs_to_sign: [1, 2],
  fee_estimate_sats: 3000,
  royalty_sats: 0,
  royalty_address: null,
};

const WIRE_PENDING_SALES = [
  { tx_id: "txid_abc", buyer_address: "bc1qbuyer", atomic_swap: { id: "swap_abc" } },
];

// buy.test.ts uses a buyer address, override the default signer address
const buyerSigner = () =>
  makeSigner({ p2wpkh: "bc1qbuyer", publicKey: "02aabbcc" });

describe("fillSwaps", () => {
  it("requests buy quote, signs PSBT, submits purchase", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_BUY_QUOTE } },
      { status: 200, body: { data: WIRE_PENDING_SALES } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    const sales = await fillSwaps(
      { swapIds: ["swap_abc"], buyerAddress: "bc1qbuyer" },
      http,
      signer,
    );

    expect(sales).toHaveLength(1);
    expect(sales[0].txId).toBe("txid_abc");

    // Sign called with full inputs list
    expect(signer.signPsbtHex).toHaveBeenCalledWith("70736274ff_buy", [1, 2]);

    // Purchase body has signed PSBT
    const [, purchaseInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(purchaseInit.body as string);
    expect(body.psbt_hex).toBe("70736274ff_buy_signed");
    expect(body.swap_ids).toEqual(["swap_abc"]);
    expect(body.buyer_address).toBe("bc1qbuyer");
  });

  it("auto-fills buyerAddress from signer when omitted", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_BUY_QUOTE } },
      { status: 200, body: { data: [] } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = buyerSigner();

    await fillSwaps({ swapIds: ["swap_abc"] }, http, signer);

    const [, quoteInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(quoteInit.body as string);
    expect(body.buyer_address).toBe("bc1qbuyer");
  });

  it("throws when buyerAddress is not P2WPKH", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      fillSwaps(
        { swapIds: ["swap_abc"], buyerAddress: "bc1psomeordinaladdress" },
        http,
        signer,
      ),
    ).rejects.toThrow("P2WPKH");
  });

  it("throws when ordinal buy has more than one swapId", async () => {
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: vi.fn() });
    const signer = makeSigner();

    await expect(
      fillSwaps(
        {
          swapIds: ["swap_1", "swap_2"],
          buyerAddress: "bc1qbuyer",
          buyerTaprootAddress: "bc1pinscription",
        },
        http,
        signer,
      ),
    ).rejects.toThrow("exactly one swapId");
  });

  it("includes buyer_taproot_address for ordinal buys", async () => {
    const fetch = makeSequentialFetch(
      { status: 200, body: { data: WIRE_BUY_QUOTE } },
      { status: 200, body: { data: [] } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const signer = makeSigner();

    await fillSwaps(
      {
        swapIds: ["swap_ordinal"],
        buyerAddress: "bc1qbuyer",
        buyerTaprootAddress: "bc1pinscription",
      },
      http,
      signer,
    );

    const [, quoteInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(quoteInit.body as string);
    expect(body.buyer_taproot_address).toBe("bc1pinscription");
  });
});
