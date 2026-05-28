import { describe, it, expect, vi } from "vitest";
import { HttpClient } from "../api/http.js";
import { delistSwap } from "./delist.js";
import { makeSequentialFetch, makeSigner } from "../test-utils.js";

describe("delistSwap", () => {
  it("starts delist, signs the request id with BIP322, confirms", async () => {
    const DELIST_REQUEST = {
      id: "dr_abc123",
      atomic_swap: { id: "swap_abc", seller_address: "bc1qseller" },
    };
    const CONFIRM_RESULT = { id: "dr_abc123", signature: "base64sig==" };

    const fetch = makeSequentialFetch(
      { status: 201, body: { data: DELIST_REQUEST } },
      { status: 201, body: { data: CONFIRM_RESULT } },
    );
    const http = new HttpClient({ baseUrl: "https://horizon.market", fetch });
    const signer = makeSigner();

    await delistSwap("swap_abc", http, signer);

    // POST to start delist
    const [startUrl, startInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(startUrl).toBe(
      "https://horizon.market/api/atomic-swaps/swap_abc/delist-requests",
    );
    expect(startInit.method).toBe("POST");

    // BIP322 signed the delist request id (not the swap id)
    expect(signer.signMessage).toHaveBeenCalledWith("bc1qseller", "dr_abc123");

    // PUT to confirm delist
    const [confirmUrl, confirmInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(confirmUrl).toBe(
      "https://horizon.market/api/atomic-swaps/delist-requests/dr_abc123",
    );
    expect(confirmInit.method).toBe("PUT");
    expect(JSON.parse(confirmInit.body as string)).toEqual({ signature: "base64sig==" });
  });

  it("returns void on success", async () => {
    const fetch = makeSequentialFetch(
      { status: 201, body: { data: { id: "dr_1", atomic_swap: { id: "swap_abc", seller_address: "bc1q" } } } },
      { status: 201, body: { data: { id: "dr_1", signature: "sig" } } },
    );
    const http = new HttpClient({ baseUrl: "https://example.com", fetch });
    const result = await delistSwap("swap_abc", http, makeSigner());
    expect(result).toBeUndefined();
  });
});
