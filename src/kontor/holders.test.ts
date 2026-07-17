import { describe, it, expect, vi } from "vitest";
import * as btc from "bitcoinjs-lib";
import { HolderRef } from "@kontor/sdk";
import {
  xOnlyFromTaprootAddress,
  holderCandidates,
  resolveSignerId,
} from "./holders.js";
import {
  TEST_P2TR_ADDRESS,
  TEST_P2WPKH_ADDRESS,
  TEST_PRIVATE_KEY_HEX,
} from "../test-utils.js";
import { LocalSigner } from "../crypto/signer.js";

/**
 * Unit tests for the pure holder-resolution helpers ported from the
 * Horizon-Market server. `xOnlyFromTaprootAddress` decodes the tweaked output
 * key from a P2TR (bech32m, witness v1, 32-byte program) address; anything else
 * — including non-taproot addresses and undecodable garbage — resolves to null.
 * `holderCandidates` unions the session key with that derived key, deduped.
 */

// The bech32m-tweaked output key expected for the mainnet P2TR fixture.
const EXPECTED_XONLY = Buffer.from(
  btc.address.fromBech32(TEST_P2TR_ADDRESS).data,
).toString("hex");

// A second, distinct taproot address (testnet) derived from a real key so the
// union in `holderCandidates` has two different members.
const TESTNET_P2TR = new LocalSigner(
  TEST_PRIVATE_KEY_HEX,
  "testnet",
).getAddresses().p2tr!;

describe("xOnlyFromTaprootAddress", () => {
  it("decodes the 32-byte tweaked output key from a P2TR address", () => {
    const xOnly = xOnlyFromTaprootAddress(TEST_P2TR_ADDRESS);
    expect(xOnly).toBe(EXPECTED_XONLY);
    expect(xOnly).toMatch(/^[0-9a-f]{64}$/);
  });

  it("decodes a testnet (tb1p) taproot address too", () => {
    const xOnly = xOnlyFromTaprootAddress(TESTNET_P2TR);
    expect(xOnly).toMatch(/^[0-9a-f]{64}$/);
    expect(xOnly).toBe(
      Buffer.from(btc.address.fromBech32(TESTNET_P2TR).data).toString("hex"),
    );
  });

  it("returns null for a non-taproot (P2WPKH, witness v0) address", () => {
    expect(xOnlyFromTaprootAddress(TEST_P2WPKH_ADDRESS)).toBeNull();
  });

  it("returns null for an undecodable / invalid address", () => {
    expect(xOnlyFromTaprootAddress("not-an-address")).toBeNull();
    expect(xOnlyFromTaprootAddress("")).toBeNull();
    // A legacy base58 address is not bech32 and must be rejected too.
    expect(
      xOnlyFromTaprootAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"),
    ).toBeNull();
  });
});

describe("holderCandidates", () => {
  const SESSION_XONLY = "aa".repeat(32);

  it("returns only the session key when no taproot address is given", () => {
    const candidates = holderCandidates(SESSION_XONLY, undefined);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBeInstanceOf(HolderRef);
  });

  it("unions the session key and the taproot-derived key (two distinct refs)", () => {
    const candidates = holderCandidates(SESSION_XONLY, TEST_P2TR_ADDRESS);
    // Session key + derived key differ, so both survive.
    expect(candidates).toHaveLength(2);
    expect(EXPECTED_XONLY).not.toBe(SESSION_XONLY);
    for (const c of candidates) expect(c).toBeInstanceOf(HolderRef);
  });

  it("deduplicates when the session key equals the derived key (case-insensitive)", () => {
    // Pass the derived key uppercased as the session key: the Set is keyed on
    // the lowercased hex, so the taproot-derived duplicate is dropped.
    const candidates = holderCandidates(
      EXPECTED_XONLY.toUpperCase(),
      TEST_P2TR_ADDRESS,
    );
    expect(candidates).toHaveLength(1);
  });

  it("skips a taproot address that does not decode to an x-only key", () => {
    // A non-taproot address yields null, so only the session key remains.
    const candidates = holderCandidates(SESSION_XONLY, TEST_P2WPKH_ADDRESS);
    expect(candidates).toHaveLength(1);
  });

  it("returns an empty union when every candidate is empty/undefined", () => {
    expect(holderCandidates("", undefined)).toEqual([]);
  });

  it("prepends the registered signer-id ref before the x-only candidates", () => {
    const candidates = holderCandidates(SESSION_XONLY, TEST_P2TR_ADDRESS, 4);
    // signer-id + session key + tweaked key.
    expect(candidates).toHaveLength(3);
    expect(candidates[0].toRaw()).toEqual({ kind: "signer-id", value: "4" });
    for (const c of candidates) expect(c).toBeInstanceOf(HolderRef);
  });

  it("omits the signer-id ref when the wallet is unregistered", () => {
    expect(holderCandidates(SESSION_XONLY, TEST_P2TR_ADDRESS, null)).toHaveLength(
      2,
    );
    expect(holderCandidates(SESSION_XONLY, TEST_P2TR_ADDRESS)).toHaveLength(2);
  });
});

describe("resolveSignerId", () => {
  const XONLY = "aa".repeat(32);
  const jsonFetch = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => body }));

  it("returns the numeric signer_id from the indexer reverse lookup", async () => {
    const fetchMock = jsonFetch({ result: { signer_id: 4 } });
    await expect(
      resolveSignerId(
        "https://indexer/api",
        XONLY,
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBe(4);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://indexer/api/signers/${XONLY}`,
    );
  });

  it("normalizes the URL (trailing slash) and key (0x prefix, case)", async () => {
    const fetchMock = jsonFetch({ result: { signer_id: 7 } });
    await resolveSignerId(
      "https://indexer/api/",
      `0x${XONLY.toUpperCase()}`,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `https://indexer/api/signers/${XONLY}`,
    );
  });

  it("returns null for an unregistered signer (not-found body or non-ok)", async () => {
    await expect(
      resolveSignerId(
        "https://indexer/api",
        XONLY,
        jsonFetch({ error: "not found" }) as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
    await expect(
      resolveSignerId(
        "https://indexer/api",
        XONLY,
        jsonFetch({}, false) as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("returns null on a network / parse error", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      resolveSignerId(
        "https://indexer/api",
        XONLY,
        throwing as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });
});
