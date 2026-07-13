import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Covers the two factory bodies that the existing suite never exercises:
 * the `transport` closure inside `makeKontorSession` (lines 33-40) and the
 * whole of `makeKontorReadSession` (lines 63-74). The `@kontor/sdk` primitives
 * (`KontorSession`, `HttpTransport`, `Identity`) are mocked so we can capture
 * the config the session is built with and invoke the transport factory by hand
 * (the real `KontorSession` would only call it lazily on first submit/view).
 */

const h = vi.hoisted(() => ({
  KontorSession: vi.fn(),
  HttpTransport: vi.fn(),
  Identity: { fromXOnly: vi.fn() },
}));

vi.mock("@kontor/sdk", () => ({
  KontorSession: h.KontorSession,
  HttpTransport: h.HttpTransport,
  Identity: h.Identity,
}));

import { makeKontorSession, makeKontorReadSession } from "./session.js";

const chain = { name: "signet" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.Identity.fromXOnly.mockReturnValue({ __identity: true });
});

describe("makeKontorSession", () => {
  it("builds a signing session whose transport factory constructs an HttpTransport", () => {
    const signing = { identity: { address: "tb1pidentity" } } as never;
    const funding = { kind: "funding" } as never;

    makeKontorSession({
      chain,
      signing,
      funding,
      indexerUrl: "https://indexer.example",
      feeRate: 7,
    });

    expect(h.KontorSession).toHaveBeenCalledTimes(1);
    const cfg = h.KontorSession.mock.calls[0][0];
    expect(cfg.chain).toBe(chain);
    expect(cfg.signing).toBe(signing);
    expect(cfg.feeRate).toBe(7);

    // Invoke the transport factory (KontorSession would do this internally).
    const identity = { __id: 1 };
    cfg.transport({ chain, identity, signing, feeRate: 7 });
    expect(h.HttpTransport).toHaveBeenCalledWith({
      chain,
      identity,
      signing,
      feeRate: 7,
      funding,
      url: "https://indexer.example",
    });
  });

  it("defaults the fee rate to undefined and threads an undefined transport fee rate", () => {
    makeKontorSession({
      chain,
      signing: {} as never,
      funding: {} as never,
      indexerUrl: "https://indexer.example",
    });

    const cfg = h.KontorSession.mock.calls[0][0];
    expect(cfg.feeRate).toBeUndefined();

    cfg.transport({ chain, identity: {}, signing: {}, feeRate: undefined });
    expect(h.HttpTransport).toHaveBeenCalledWith(
      expect.objectContaining({ feeRate: undefined, url: "https://indexer.example" }),
    );
  });
});

describe("makeKontorReadSession", () => {
  it("derives a read-only identity from the x-only pubkey and wires the indexer transport", () => {
    const xOnlyPubkey = "ab".repeat(32);
    const fetchImpl = vi.fn() as unknown as typeof globalThis.fetch;

    makeKontorReadSession({
      chain,
      xOnlyPubkey,
      indexerUrl: "https://read.example",
      fetch: fetchImpl,
    });

    expect(h.Identity.fromXOnly).toHaveBeenCalledWith(xOnlyPubkey, chain);
    expect(h.KontorSession).toHaveBeenCalledTimes(1);

    const cfg = h.KontorSession.mock.calls[0][0];
    expect(cfg.chain).toBe(chain);
    expect(cfg.identity).toEqual({ __identity: true });
    expect(cfg.fetch).toBe(fetchImpl);
    // A read-only session carries no signing/funding.
    expect(cfg.signing).toBeUndefined();

    const identity = { __id: 2 };
    cfg.transport({ chain, identity });
    expect(h.HttpTransport).toHaveBeenCalledWith({
      chain,
      identity,
      url: "https://read.example",
    });
  });

  it("works without an injected fetch (leaves it undefined for the SDK default)", () => {
    makeKontorReadSession({
      chain,
      xOnlyPubkey: "cd".repeat(32),
      indexerUrl: "https://read.example",
    });
    const cfg = h.KontorSession.mock.calls[0][0];
    expect(cfg.fetch).toBeUndefined();
  });
});
