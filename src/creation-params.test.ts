import { describe, it, expect } from "vitest";
import {
  assertCreationQuoteParams,
  isFundableCreationAddress,
  isIpfsUri,
  isNumericAssetName,
  parentAssetOf,
  randomNumericAssetName,
  validateCounterpartyAssetName,
  validateCreationAttributes,
  validateCreationQuantity,
  xcpNameFee,
  COUNTERPARTY_NUMERIC_MAX,
  COUNTERPARTY_NUMERIC_MIN,
} from "./creation-params.js";
import type { CreationQuoteParams } from "./api/creations.js";

describe("validateCounterpartyAssetName", () => {
  const valid = [
    "MYASSET",
    "BEEP",
    "ZZZZZZZZZZZZ",
    `A${COUNTERPARTY_NUMERIC_MIN}`,
    `A${COUNTERPARTY_NUMERIC_MAX}`,
    "PEPENARDO.card-1_@!",
    `A${COUNTERPARTY_NUMERIC_MIN}.child`,
  ];
  for (const name of valid) {
    it(`accepts ${name}`, () => {
      expect(validateCounterpartyAssetName(name)).toBeNull();
    });
  }

  const invalid: [string, string][] = [
    ["ABC", "too short"],
    ["ANIMAL", "starts with A but is not numeric"],
    ["myasset", "lowercase"],
    ["ZZZZZZZZZZZZZ", "13 letters"],
    [`A${COUNTERPARTY_NUMERIC_MIN - 1n}`, "below the numeric floor"],
    [`A${COUNTERPARTY_NUMERIC_MAX + 1n}`, "above the numeric ceiling"],
    [`PEPENARDO.${"c".repeat(250)}`, "over 250 characters in total"],
    ["PEPENARDO.card space", "child charset"],
    ["", "empty"],
  ];
  for (const [name, why] of invalid) {
    it(`rejects ${why}`, () => {
      expect(validateCounterpartyAssetName(name)).toBeTypeOf("string");
    });
  }
});

describe("parentAssetOf / isNumericAssetName / xcpNameFee", () => {
  it("reads a subasset's parent, and null for a plain name", () => {
    expect(parentAssetOf("PEPENARDO.card")).toBe("PEPENARDO");
    expect(parentAssetOf(`A${COUNTERPARTY_NUMERIC_MIN}.card`)).toBe(
      `A${COUNTERPARTY_NUMERIC_MIN}`,
    );
    expect(parentAssetOf("MYASSET")).toBeNull();
  });

  it("recognises an in-range numeric name only", () => {
    expect(isNumericAssetName(`A${COUNTERPARTY_NUMERIC_MIN}`)).toBe(true);
    expect(isNumericAssetName(`A${COUNTERPARTY_NUMERIC_MIN - 1n}`)).toBe(false);
    expect(isNumericAssetName("MYASSET")).toBe(false);
  });

  it("prices the name: 0.5 named, 0.25 subasset, free numeric", () => {
    expect(xcpNameFee("MYASSET")).toBe(0.5);
    expect(xcpNameFee("PEPENARDO.card")).toBe(0.25);
    expect(xcpNameFee(`A${COUNTERPARTY_NUMERIC_MIN}`)).toBe(0);
  });

  it("prices a name nobody has typed at nothing", () => {
    // Otherwise an untouched form reads as a 0.5 XCP registration: it warns
    // about a balance, and blocks, over a name that does not exist yet.
    expect(xcpNameFee("")).toBe(0);
    expect(xcpNameFee("   ")).toBe(0);
  });
});

describe("randomNumericAssetName", () => {
  it("generates a free, valid, in-range numeric name", () => {
    for (let i = 0; i < 200; i += 1) {
      const name = randomNumericAssetName();
      expect(validateCounterpartyAssetName(name)).toBeNull();
      expect(isNumericAssetName(name)).toBe(true);
      // The whole point of offering it: this one costs no XCP.
      expect(xcpNameFee(name)).toBe(0);
      const value = BigInt(name.slice(1));
      expect(value).toBeGreaterThanOrEqual(COUNTERPARTY_NUMERIC_MIN);
      expect(value).toBeLessThanOrEqual(COUNTERPARTY_NUMERIC_MAX);
    }
  });

  it("does not repeat itself", () => {
    const names = new Set(
      Array.from({ length: 100 }, () => randomNumericAssetName()),
    );
    expect(names.size).toBe(100);
  });
});

describe("isIpfsUri", () => {
  it("accepts both spellings, either case", () => {
    expect(isIpfsUri("ipfs://bafyimage")).toBe(true);
    expect(isIpfsUri("ipfs:bafyimage")).toBe(true);
    expect(isIpfsUri("IPFS://bafyimage")).toBe(true);
    expect(isIpfsUri("  ipfs://bafyimage  ")).toBe(true);
  });

  it("rejects a gateway URL — the mistake this exists to catch", () => {
    expect(isIpfsUri("https://ipfs.io/ipfs/bafyimage")).toBe(false);
    expect(isIpfsUri("")).toBe(false);
    expect(isIpfsUri("ipfs://")).toBe(false);
  });
});

describe("validateCreationAttributes", () => {
  it("accepts 32 entries and rejects 33", () => {
    const at = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`k${i}`, "v"]),
      );
    expect(validateCreationAttributes(at(32))).toBeNull();
    expect(validateCreationAttributes(at(33))).toBeTypeOf("string");
  });

  it("measures bytes, not characters", () => {
    // "é" is two UTF-8 bytes, so 2100 of them exceed 4096 while the string
    // length does not.
    const multiByte = { note: "é".repeat(2100) };
    expect(JSON.stringify(multiByte).length).toBeLessThan(4096);
    expect(validateCreationAttributes(multiByte)).toBeTypeOf("string");
    expect(validateCreationAttributes({ note: "é".repeat(100) })).toBeNull();
  });

  it("rejects a nameless attribute", () => {
    expect(validateCreationAttributes({ "": "value" })).toBeTypeOf("string");
  });
});

describe("validateCreationQuantity", () => {
  it("requires a whole number when the asset is not divisible", () => {
    expect(validateCreationQuantity("100", false)).toBeNull();
    expect(validateCreationQuantity("1.5", false)).toBeTypeOf("string");
    expect(validateCreationQuantity("1.5", true)).toBeNull();
  });

  it("rejects zero, negatives, junk, and over-precise decimals", () => {
    expect(validateCreationQuantity("0", false)).toBeTypeOf("string");
    expect(validateCreationQuantity("-1", false)).toBeTypeOf("string");
    expect(validateCreationQuantity("lots", false)).toBeTypeOf("string");
    expect(validateCreationQuantity("1.123456789", true)).toBeTypeOf("string");
  });
});

describe("isFundableCreationAddress", () => {
  it("takes segwit, taproot and legacy, but not P2SH-wrapped segwit", () => {
    expect(isFundableCreationAddress("bc1qfunding")).toBe(true);
    expect(isFundableCreationAddress("tb1qfunding")).toBe(true);
    expect(isFundableCreationAddress("bc1pfunding")).toBe(true);
    expect(isFundableCreationAddress("1LegacyAddress")).toBe(true);
    expect(isFundableCreationAddress("3P2shWrapped")).toBe(false);
    expect(isFundableCreationAddress("2P2shWrappedTestnet")).toBe(false);
  });
});

describe("assertCreationQuoteParams", () => {
  const counterparty: CreationQuoteParams = {
    type: "counterparty",
    name: "MYASSET",
    image: "ipfs://bafyimage",
    address: "bc1qfunding",
  };

  it("passes a well-formed request", () => {
    expect(() => assertCreationQuoteParams(counterparty)).not.toThrow();
  });

  it("rejects a gateway image URL before a quote is ever spent", () => {
    expect(() =>
      assertCreationQuoteParams({
        ...counterparty,
        image: "https://ipfs.io/ipfs/bafyimage",
      }),
    ).toThrow(/ipfs:\/\//);
  });

  it("rejects a P2SH-wrapped funding address", () => {
    expect(() =>
      assertCreationQuoteParams({ ...counterparty, address: "3P2shWrapped" }),
    ).toThrow(/P2SH/);
  });

  it("requires a public key when funding from taproot", () => {
    expect(() =>
      assertCreationQuoteParams({ ...counterparty, address: "bc1pfunding" }),
    ).toThrow(/public key/);

    expect(() =>
      assertCreationQuoteParams({
        ...counterparty,
        address: "bc1pfunding",
        publicKey: "nothex",
      }),
    ).toThrow(/64 \(x-only\) or 66/);

    expect(() =>
      assertCreationQuoteParams({
        ...counterparty,
        address: "bc1pfunding",
        publicKey: "a".repeat(64),
      }),
    ).not.toThrow();
  });

  it("requires a taproot receive address for an ordinal, and refuses legacy funding", () => {
    expect(() =>
      assertCreationQuoteParams({
        type: "ordinals",
        name: "My inscription",
        image: "ipfs://bafyimage",
        address: "bc1qfunding",
      }),
    ).toThrow(/P2TR address to receive/);

    expect(() =>
      assertCreationQuoteParams({
        type: "ordinals",
        name: "My inscription",
        image: "ipfs://bafyimage",
        address: "1LegacyAddress",
        taprootAddress: "bc1preceiver",
      }),
    ).toThrow(/legacy address/);
  });

  it("bounds the fee rate", () => {
    expect(() =>
      assertCreationQuoteParams({ ...counterparty, options: { feeRate: 0 } }),
    ).toThrow(/1 and 2000/);
    expect(() =>
      assertCreationQuoteParams({ ...counterparty, options: { feeRate: 2001 } }),
    ).toThrow(/1 and 2000/);
  });

  it("rejects a fractional supply on an indivisible asset", () => {
    expect(() =>
      assertCreationQuoteParams({
        ...counterparty,
        options: { quantity: "1.5", divisible: false },
      }),
    ).toThrow(/whole-number/);
  });
});
