import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "./http.js";
import { requestBuyQuote } from "./buy-quotes.js";
import { makeFetch } from "../test-utils.js";

const WIRE_BUY_QUOTE = {
  psbt: "70736274ff_buy",
  inputs_to_sign: [1, 2],
  fee_estimate_sats: 3000,
  royalty_sats: 0,
  royalty_address: null,
};

describe("requestBuyQuote", () => {
  it("maps wire response to domain BuyQuote", async () => {
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: WIRE_BUY_QUOTE }),
    });
    const quote = await requestBuyQuote(http, {
      swapIds: ["swap_abc"],
      buyerAddress: "bc1qbuyer",
    });
    expect(quote).toEqual({
      psbt: "70736274ff_buy",
      inputsToSign: [1, 2],
      feeEstimateSats: 3000,
      royaltySats: 0,
      royaltyAddress: null,
    });
  });

  it("sends flat snake_case body without data wrapper", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_BUY_QUOTE });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestBuyQuote(http, {
      swapIds: ["swap_abc", "swap_def"],
      buyerAddress: "bc1qbuyer",
      detach: true,
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.swap_ids).toEqual(["swap_abc", "swap_def"]);
    expect(body.buyer_address).toBe("bc1qbuyer");
    expect(body.detach).toBe(true);
    expect(body).not.toHaveProperty("data");
  });

  it("includes buyer_taproot_address for ordinal buys", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_BUY_QUOTE });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestBuyQuote(http, {
      swapIds: ["swap_ordinal"],
      buyerAddress: "bc1qbuyer",
      buyerTaprootAddress: "bc1pinscription",
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.buyer_taproot_address).toBe("bc1pinscription");
  });

  it("omits optional params when not provided", async () => {
    const fetchFn = makeFetch(200, { data: WIRE_BUY_QUOTE });
    const http = new HttpClient({ baseUrl: "https://example.com", fetch: fetchFn });
    await requestBuyQuote(http, { swapIds: ["swap_abc"], buyerAddress: "bc1qbuyer" });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("buyer_taproot_address");
    expect(body).not.toHaveProperty("sats_per_vbyte");
    expect(body).not.toHaveProperty("detach");
  });

  it("maps royalty_address when present", async () => {
    const wire = { ...WIRE_BUY_QUOTE, royalty_sats: 1000, royalty_address: "bc1qroyalty" };
    const http = new HttpClient({
      baseUrl: "https://example.com",
      fetch: makeFetch(200, { data: wire }),
    });
    const quote = await requestBuyQuote(http, {
      swapIds: ["swap_abc"],
      buyerAddress: "bc1qbuyer",
    });
    expect(quote.royaltySats).toBe(1000);
    expect(quote.royaltyAddress).toBe("bc1qroyalty");
  });
});
