import { describe, expect, it, vi } from "vitest";
import { resolveFetch } from "./resolveFetch.js";

describe("resolveFetch", () => {
  it("forwards calls to a custom implementation", async () => {
    const custom = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const fetchFn = resolveFetch(custom);
    await fetchFn("https://example.com/api");
    expect(custom).toHaveBeenCalledWith("https://example.com/api");
  });

  it("returns a bound function when using the default fetch", () => {
    const fetchFn = resolveFetch();
    expect(fetchFn).not.toBe(globalThis.fetch);
    expect(typeof fetchFn).toBe("function");
  });
});
