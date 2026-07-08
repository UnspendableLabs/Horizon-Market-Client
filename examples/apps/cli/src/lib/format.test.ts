import { describe, it, expect } from "vitest";
import {
  toBaseUnits,
  satsToBtc,
  formatSats,
  formatUsd,
  truncate,
  formatAge,
} from "./format.js";

describe("toBaseUnits", () => {
  it("scales a divisible amount by 1e8", () => {
    expect(toBaseUnits("1", true)).toBe(100_000_000n);
    expect(toBaseUnits("1.5", true)).toBe(150_000_000n);
    expect(toBaseUnits("0.00010000", true)).toBe(10_000n);
    expect(toBaseUnits("0.00000001", true)).toBe(1n);
  });

  it("keeps an indivisible amount as an integer count", () => {
    expect(toBaseUnits("1", false)).toBe(1n);
    expect(toBaseUnits("42", false)).toBe(42n);
  });

  it("rejects fractional amounts for indivisible assets", () => {
    expect(() => toBaseUnits("1.5", false)).toThrow(/whole-number/);
  });

  it("rejects more than 8 decimal places for divisible assets", () => {
    expect(() => toBaseUnits("0.000000001", true)).toThrow(/8 decimal/);
  });

  it("rejects empty / malformed input", () => {
    expect(() => toBaseUnits("", true)).toThrow(/required/);
    expect(() => toBaseUnits("  ", true)).toThrow(/required/);
    expect(() => toBaseUnits("abc", true)).toThrow(/Invalid amount/);
    expect(() => toBaseUnits("1.2.3", true)).toThrow(/Invalid amount/);
  });
});

describe("satsToBtc", () => {
  it("formats sats as an 8-decimal BTC string", () => {
    expect(satsToBtc(0n)).toBe("0.00000000");
    expect(satsToBtc(1n)).toBe("0.00000001");
    expect(satsToBtc(100_000_000n)).toBe("1.00000000");
    expect(satsToBtc(150_000_000n)).toBe("1.50000000");
  });

  it("handles negative values", () => {
    expect(satsToBtc(-10_000n)).toBe("-0.00010000");
  });

  it("round-trips with toBaseUnits", () => {
    expect(satsToBtc(toBaseUnits("2.34567890", true))).toBe("2.34567890");
  });
});

describe("formatSats", () => {
  it("group-separates thousands", () => {
    expect(formatSats(3450)).toBe("3,450");
    expect(formatSats(1_000_000)).toBe("1,000,000");
  });
});

describe("formatUsd", () => {
  it("converts sats to USD at a BTC price", () => {
    // 100_000_000 sats = 1 BTC → $50,000.00
    expect(formatUsd(100_000_000, 50_000)).toBe("$50,000.00");
  });

  it("uses extra precision for sub-cent amounts", () => {
    const s = formatUsd(1000, 50_000); // 0.00001 BTC → $0.50 -> actually $0.50
    expect(s).toBe("$0.50");
  });

  it("returns null without a price", () => {
    expect(formatUsd(1000, null)).toBeNull();
    expect(formatUsd(1000, undefined)).toBeNull();
    expect(formatUsd(1000, Number.NaN)).toBeNull();
  });
});

describe("truncate", () => {
  it("middle-truncates long ids", () => {
    expect(truncate("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefgh…uvwxyz");
  });

  it("leaves short strings intact", () => {
    expect(truncate("short")).toBe("short");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-07-08T12:00:00Z");
  it("renders relative ages", () => {
    expect(formatAge("2026-07-08T11:59:30Z", now)).toBe("just now");
    expect(formatAge("2026-07-08T11:30:00Z", now)).toBe("30 min ago");
    expect(formatAge("2026-07-08T09:00:00Z", now)).toBe("3 hr ago");
    expect(formatAge("2026-07-07T12:00:00Z", now)).toBe("1 day ago");
    expect(formatAge("2026-07-05T12:00:00Z", now)).toBe("3 days ago");
  });

  it("returns an em-dash for missing / invalid input", () => {
    expect(formatAge(null, now)).toBe("—");
    expect(formatAge("not-a-date", now)).toBe("—");
  });
});
