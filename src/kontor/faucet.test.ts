import { describe, it, expect, vi } from "vitest";
import { requestKontorFaucet, KONTOR_FAUCET_AMOUNT_KOR } from "./faucet.js";

/**
 * The faucet is the one Kontor call a stuck user makes, so its failure path is
 * the part that matters: an account with no KOR can do nothing else, and a
 * refusal the UI can't explain leaves them with no next step.
 */

function res(
  ok: boolean,
  status: number,
  body: unknown | (() => never),
): Response {
  return {
    ok,
    status,
    json: () =>
      typeof body === "function"
        ? Promise.reject(new Error("not JSON"))
        : Promise.resolve(body),
  } as unknown as Response;
}

describe("requestKontorFaucet", () => {
  it("posts the recipient key and the default grant, and returns both txids", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        res(true, 200, { commit_txid: "aa11", reveal_txid: "bb22" }),
      );

    const result = await requestKontorFaucet({
      url: "https://signet.horizon.market/api/kontor-faucet",
      recipient: "ab".repeat(32),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    expect(result).toEqual({ commitTxid: "aa11", revealTxid: "bb22" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://signet.horizon.market/api/kontor-faucet");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      recipient: "ab".repeat(32),
      amount: KONTOR_FAUCET_AMOUNT_KOR,
    });
  });

  it("sends a caller-chosen amount instead of the default", async () => {
    const fetch = vi.fn().mockResolvedValue(res(true, 200, {}));
    await requestKontorFaucet({
      url: "https://f/api",
      recipient: "cd".repeat(32),
      amount: 3,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).amount).toBe(3);
  });

  it("surfaces the faucet's own refusal message, not a generic one", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        res(false, 429, { error: { message: "FAUCET_RATE_LIMITED" } }),
      );

    await expect(
      requestKontorFaucet({
        url: "https://f/api",
        recipient: "ef".repeat(32),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("FAUCET_RATE_LIMITED");
  });

  // horizon.market's proxy reports its own failure to reach the Portal as a bare
  // string, not the Portal's `{ message }` object. Reading only one shape would
  // replace the one useful sentence with "HTTP 502".
  it("surfaces a bare-string error from the proxy in front of the Portal", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(res(false, 502, { error: "upstream fetch failed" }));

    await expect(
      requestKontorFaucet({
        url: "https://f/api",
        recipient: "ef".repeat(32),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("upstream fetch failed");
  });

  // No grant was made, so resolving here would leave the user watching for KOR
  // that is never coming, with two empty txids and nothing to explain why.
  it("rejects an error payload carried under a 200", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        res(true, 200, { error: { message: "FAUCET_FAILED" } }),
      );

    await expect(
      requestKontorFaucet({
        url: "https://f/api",
        recipient: "ef".repeat(32),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("FAUCET_FAILED");
  });

  it("still reports the status when the body isn't JSON (a proxy 404 page)", async () => {
    const fetch = vi.fn().mockResolvedValue(
      res(false, 404, () => {
        throw new Error("unreachable");
      }),
    );

    await expect(
      requestKontorFaucet({
        url: "https://f/api",
        recipient: "ef".repeat(32),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it("treats missing txids as empty rather than failing a successful grant", async () => {
    const fetch = vi.fn().mockResolvedValue(res(true, 200, {}));
    await expect(
      requestKontorFaucet({
        url: "https://f/api",
        recipient: "ef".repeat(32),
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({ commitTxid: "", revealTxid: "" });
  });
});
