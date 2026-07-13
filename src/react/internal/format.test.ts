import { describe, expect, it } from "vitest";
import type { AtomicSwap } from "../../types/index.js";
import type { AssetOption } from "../hooks/useAssets.js";
import {
  CLIENT_NOT_INITIALIZED,
  assetBalanceLabel,
  assetImageUrl,
  assetKey,
  buyingDisplay,
  counterpartyXcpFirst,
  cx,
  describeAsset,
  formatAmount,
  formatAssetLabel,
  formatRelativeTime,
  formatSats,
  formatUsd,
  kontorKorFirst,
  mempoolApiBase,
  mempoolTxUrl,
  satsToUsd,
  sellingDisplay,
  toBaseUnits,
  truncate,
} from "./format.js";

// ─── AssetOption factories ────────────────────────────────────────────────────

function cp(over: Partial<Extract<AssetOption, { type: "counterparty" }>> = {}): AssetOption {
  return {
    type: "counterparty",
    assetName: "TEST",
    address: "addrCP",
    balance: 0n,
    quantityNormalized: "1.5",
    divisible: true,
    ...over,
  };
}

function zeld(over: Partial<Extract<AssetOption, { type: "zeld" }>> = {}): AssetOption {
  return {
    type: "zeld",
    address: "addrZ",
    balance: 0n,
    quantityNormalized: "42",
    divisible: true,
    ...over,
  };
}

function kor(over: Partial<Extract<AssetOption, { type: "kor" }>> = {}): AssetOption {
  return { type: "kor", address: "addrK", amount: "100", ...over };
}

function nft(over: Partial<Extract<AssetOption, { type: "kontor-nft" }>> = {}): AssetOption {
  return {
    type: "kontor-nft",
    nftId: "nftidnftidnftidnftidnftid",
    contractAddress: "contract@1.2",
    address: "addrN",
    ...over,
  };
}

function ord(over: Partial<Extract<AssetOption, { type: "ordinal" }>> = {}): AssetOption {
  return {
    type: "ordinal",
    inscriptionId: "insc1234567890abcdefghij",
    utxoId: "txid:0",
    address: "addrO",
    ...over,
  };
}

// ─── AtomicSwap factory ───────────────────────────────────────────────────────

function swap(over: Partial<AtomicSwap> = {}): AtomicSwap {
  return {
    id: "swap-id",
    listingType: "counterparty",
    sellerAddress: "bc1qseller",
    buyerAddress: null,
    assetUtxoId: null,
    assetUtxoValue: null,
    assetName: "TEST",
    assetQuantity: 1n,
    price: 1000,
    pricePerUnit: 1000,
    psbtHex: null,
    txId: null,
    blockIndex: null,
    funded: true,
    filled: false,
    confirmed: true,
    delisted: false,
    sellerDelisted: false,
    expired: false,
    pending: false,
    anomalous: false,
    royalty: null,
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    onChainPayment: null,
    imageUrl: null,
    thumbnailUrl: null,
    inscriptionNumber: null,
    assetDivisibility: null,
    kontorOfferBlob: null,
    kontorAssetKind: null,
    kontorContractAddress: null,
    kontorNftId: null,
    kontorAmount: null,
    ...over,
  };
}

// ─── toBaseUnits ──────────────────────────────────────────────────────────────

describe("toBaseUnits", () => {
  it("throws when the input is empty or whitespace", () => {
    expect(() => toBaseUnits("", true)).toThrow("Quantity required");
    expect(() => toBaseUnits("   ", false)).toThrow("Quantity required");
  });

  it("parses a whole-number indivisible quantity", () => {
    expect(toBaseUnits("5", false)).toBe(5n);
    expect(toBaseUnits(" 12 ", false)).toBe(12n);
  });

  it("rejects a non-integer indivisible quantity", () => {
    expect(() => toBaseUnits("1.5", false)).toThrow(
      "Indivisible assets require a whole-number quantity",
    );
    expect(() => toBaseUnits("abc", false)).toThrow(
      "Indivisible assets require a whole-number quantity",
    );
  });

  it("rejects a malformed divisible quantity", () => {
    expect(() => toBaseUnits("1.2.3", true)).toThrow("Invalid quantity");
    expect(() => toBaseUnits("1.", true)).toThrow("Invalid quantity");
    expect(() => toBaseUnits("-1", true)).toThrow("Invalid quantity");
  });

  it("rejects excess precision", () => {
    expect(() => toBaseUnits("1.123456789", true)).toThrow(
      "Divisible assets support at most 8 decimal places",
    );
  });

  it("converts a divisible whole number", () => {
    expect(toBaseUnits("1", true)).toBe(100_000_000n);
    expect(toBaseUnits("0", true)).toBe(0n);
  });

  it("converts a divisible fractional amount with padding", () => {
    expect(toBaseUnits("1.5", true)).toBe(150_000_000n);
    expect(toBaseUnits("0.00000001", true)).toBe(1n);
    expect(toBaseUnits("2.12345678", true)).toBe(212_345_678n);
  });
});

// ─── formatAmount ─────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("returns the raw integer for indivisible assets", () => {
    expect(formatAmount(5n, false)).toBe("5");
    expect(formatAmount(0n, false)).toBe("0");
  });

  it("drops the fraction when it is zero for divisible assets", () => {
    expect(formatAmount(100_000_000n, true)).toBe("1");
    expect(formatAmount(0n, true)).toBe("0");
  });

  it("formats a fractional divisible amount, trimming trailing zeros", () => {
    expect(formatAmount(150_000_000n, true)).toBe("1.5");
    expect(formatAmount(1n, true)).toBe("0.00000001");
    expect(formatAmount(212_345_678n, true)).toBe("2.12345678");
  });
});

// ─── assetBalanceLabel ────────────────────────────────────────────────────────

describe("assetBalanceLabel", () => {
  it("returns the normalized quantity for counterparty and zeld", () => {
    expect(assetBalanceLabel(cp({ quantityNormalized: "3.3" }))).toBe("3.3");
    expect(assetBalanceLabel(zeld({ quantityNormalized: "7" }))).toBe("7");
  });

  it("returns the amount for kor", () => {
    expect(assetBalanceLabel(kor({ amount: "9" }))).toBe("9");
  });

  it("returns empty string for ordinals and nfts", () => {
    expect(assetBalanceLabel(ord())).toBe("");
    expect(assetBalanceLabel(nft())).toBe("");
  });
});

// ─── counterpartyXcpFirst ─────────────────────────────────────────────────────

describe("counterpartyXcpFirst", () => {
  it("pins XCP first and keeps the rest in order", () => {
    const a = cp({ assetName: "AAA" });
    const x = cp({ assetName: "XCP" });
    const b = cp({ assetName: "BBB" });
    expect(counterpartyXcpFirst([a, x, b])).toEqual([x, a, b]);
  });

  it("is a no-op when there is no XCP", () => {
    const a = cp({ assetName: "AAA" });
    const b = cp({ assetName: "BBB" });
    expect(counterpartyXcpFirst([a, b])).toEqual([a, b]);
  });

  it("does not treat a non-counterparty as XCP", () => {
    const z = zeld();
    const a = cp({ assetName: "AAA" });
    expect(counterpartyXcpFirst([z, a])).toEqual([z, a]);
  });
});

// ─── kontorKorFirst ───────────────────────────────────────────────────────────

describe("kontorKorFirst", () => {
  it("pins KOR first and keeps NFTs in order", () => {
    const n1 = nft({ nftId: "one" });
    const k = kor();
    const n2 = nft({ nftId: "two" });
    expect(kontorKorFirst([n1, k, n2])).toEqual([k, n1, n2]);
  });

  it("is a no-op when there is no KOR", () => {
    const n1 = nft({ nftId: "one" });
    const n2 = nft({ nftId: "two" });
    expect(kontorKorFirst([n1, n2])).toEqual([n1, n2]);
  });
});

// ─── describeAsset ────────────────────────────────────────────────────────────

describe("describeAsset", () => {
  it("describes each asset type", () => {
    expect(describeAsset(zeld({ quantityNormalized: "5" }))).toBe("ZELD — 5");
    expect(describeAsset(cp({ assetName: "PEPE", quantityNormalized: "2" }))).toBe(
      "PEPE — 2",
    );
    expect(describeAsset(kor({ amount: "8" }))).toBe("KOR — 8");
    expect(
      describeAsset(nft({ nftId: "abcdef0123456789zzzzzz" })),
    ).toBe("NFT abcdef01…zzzzzz");
    expect(
      describeAsset(ord({ inscriptionId: "abcdef0123456789" })),
    ).toBe("Inscription abcdef01…");
  });
});

// ─── sellingDisplay ───────────────────────────────────────────────────────────

describe("sellingDisplay", () => {
  it("formats counterparty", () => {
    expect(sellingDisplay(cp({ assetName: "PEPE" }), "3")).toEqual({
      name: "PEPE",
      sub: "3 units",
    });
  });

  it("formats zeld", () => {
    expect(sellingDisplay(zeld(), "10")).toEqual({ name: "ZELD", sub: "10 ZELD" });
  });

  it("formats kor", () => {
    expect(sellingDisplay(kor(), "4")).toEqual({ name: "KOR", sub: "4 KOR" });
  });

  it("formats a kontor nft with a truncated id and no sub", () => {
    const long = "a".repeat(40);
    expect(sellingDisplay(nft({ nftId: long }), "1")).toEqual({
      name: `NFT ${truncate(long)}`,
      sub: null,
    });
  });

  it("formats an ordinal with a truncated inscription id as sub", () => {
    const long = "b".repeat(40);
    expect(sellingDisplay(ord({ inscriptionId: long }), "1")).toEqual({
      name: "Inscription",
      sub: truncate(long),
    });
  });
});

// ─── buyingDisplay ────────────────────────────────────────────────────────────

describe("buyingDisplay", () => {
  it("ordinal with an inscription number", () => {
    expect(
      buyingDisplay(swap({ listingType: "ordinal", inscriptionNumber: 77 })),
    ).toEqual({ name: "Inscription", sub: "#77" });
  });

  it("ordinal without a number falls back to the truncated utxo id", () => {
    const utxo = "u".repeat(40);
    expect(
      buyingDisplay(
        swap({ listingType: "ordinal", inscriptionNumber: null, assetUtxoId: utxo }),
      ),
    ).toEqual({ name: "Inscription", sub: truncate(utxo) });
  });

  it("ordinal without a number or utxo id falls back to the truncated swap id", () => {
    const id = "i".repeat(40);
    expect(
      buyingDisplay(
        swap({ id, listingType: "ordinal", inscriptionNumber: null, assetUtxoId: null }),
      ),
    ).toEqual({ name: "Inscription", sub: truncate(id) });
  });

  it("kontor nft with an id", () => {
    const nftId = "n".repeat(40);
    expect(
      buyingDisplay(
        swap({ listingType: "kontor", kontorAssetKind: "nft", kontorNftId: nftId }),
      ),
    ).toEqual({ name: `NFT ${truncate(nftId)}`, sub: null });
  });

  it("kontor nft without an id", () => {
    expect(
      buyingDisplay(
        swap({ listingType: "kontor", kontorAssetKind: "nft", kontorNftId: null }),
      ),
    ).toEqual({ name: "NFT", sub: null });
  });

  it("kontor token with an amount", () => {
    expect(
      buyingDisplay(
        swap({ listingType: "kontor", kontorAssetKind: "token", kontorAmount: "12" }),
      ),
    ).toEqual({ name: "KOR", sub: "12 KOR" });
  });

  it("kontor token without an amount", () => {
    expect(
      buyingDisplay(
        swap({ listingType: "kontor", kontorAssetKind: "token", kontorAmount: null }),
      ),
    ).toEqual({ name: "KOR", sub: null });
  });

  it("counterparty with name and quantity", () => {
    expect(
      buyingDisplay(swap({ listingType: "counterparty", assetName: "PEPE", assetQuantity: 5n })),
    ).toEqual({ name: "PEPE", sub: "5 units" });
  });

  it("counterparty falling back to defaults when name and quantity are missing", () => {
    expect(
      buyingDisplay(swap({ listingType: "counterparty", assetName: null, assetQuantity: null })),
    ).toEqual({ name: "Asset", sub: null });
  });

  it("zeld uses the asset name as the unit", () => {
    expect(
      buyingDisplay(swap({ listingType: "zeld", assetName: "ZELD", assetQuantity: 3n })),
    ).toEqual({ name: "ZELD", sub: "3 ZELD" });
  });
});

// ─── assetImageUrl (covers assetImageIdentity) ────────────────────────────────

describe("assetImageUrl", () => {
  it("builds a counterparty thumbnail url by default", () => {
    const url = assetImageUrl("https://horizon.market", cp({ assetName: "PEPE" }));
    expect(url).toBe(
      "https://horizon.market/api/atomic-swaps/asset-image?asset=PEPE&listing_type=counterparty&redirect=thumbnail",
    );
  });

  it("uses the brand name for zeld and kor", () => {
    expect(assetImageUrl("https://h.m", zeld())).toContain("asset=ZELD");
    expect(assetImageUrl("https://h.m", zeld())).toContain("listing_type=zeld");
    expect(assetImageUrl("https://h.m", kor())).toContain("asset=KOR");
    expect(assetImageUrl("https://h.m", kor())).toContain("listing_type=kontor");
  });

  it("uses the nft id and ordinal inscription id", () => {
    expect(assetImageUrl("https://h.m", nft({ nftId: "NFT1" }))).toContain(
      "asset=NFT1",
    );
    expect(
      assetImageUrl("https://h.m", ord({ inscriptionId: "INS1" })),
    ).toContain("listing_type=ordinal");
  });

  it("honours the full-image variant", () => {
    expect(assetImageUrl("https://h.m", cp(), "image")).toContain(
      "redirect=image",
    );
  });

  it("strips a trailing slash from the base url", () => {
    expect(assetImageUrl("https://horizon.market/", cp({ assetName: "X" }))).toBe(
      "https://horizon.market/api/atomic-swaps/asset-image?asset=X&listing_type=counterparty&redirect=thumbnail",
    );
  });
});

// ─── assetKey ─────────────────────────────────────────────────────────────────

describe("assetKey", () => {
  it("builds a stable key per asset type", () => {
    expect(assetKey(zeld({ address: "a1" }))).toBe("zeld:a1");
    expect(assetKey(cp({ address: "a2", assetName: "PEPE" }))).toBe("cp:a2:PEPE");
    expect(assetKey(kor({ address: "a3" }))).toBe("kor:a3");
    expect(
      assetKey(nft({ address: "a4", contractAddress: "c", nftId: "n" })),
    ).toBe("nft:a4:c:n");
    expect(assetKey(ord({ utxoId: "tx:1", inscriptionId: "ins" }))).toBe(
      "ord:tx:1:ins",
    );
  });
});

// ─── formatAssetLabel ─────────────────────────────────────────────────────────

describe("formatAssetLabel", () => {
  it("labels an ordinal by its utxo id", () => {
    expect(
      formatAssetLabel(swap({ listingType: "ordinal", assetUtxoId: "tx:2" })),
    ).toBe("Inscription tx:2");
  });

  it("labels an ordinal by swap id when the utxo id is absent", () => {
    expect(
      formatAssetLabel(swap({ id: "swp", listingType: "ordinal", assetUtxoId: null })),
    ).toBe("Inscription swp");
  });

  it("labels a fungible swap by quantity and name", () => {
    expect(
      formatAssetLabel(swap({ assetName: "PEPE", assetQuantity: 3n })),
    ).toBe("3 PEPE");
  });

  it("uses placeholders when quantity and name are missing", () => {
    expect(
      formatAssetLabel(swap({ assetName: null, assetQuantity: null })),
    ).toBe("? ?");
  });
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("short")).toBe("short");
    // exactly head + tail + 1 (15) is still returned whole
    expect(truncate("123456789012345")).toBe("123456789012345");
  });

  it("truncates long strings with the default head/tail", () => {
    expect(truncate("1234567890123456")).toBe("12345678…123456");
  });

  it("honours custom head and tail lengths", () => {
    expect(truncate("abcdefghijkl", 2, 2)).toBe("ab…kl");
  });
});

// ─── mempoolTxUrl ─────────────────────────────────────────────────────────────

describe("mempoolTxUrl", () => {
  it("returns null without a txid", () => {
    expect(mempoolTxUrl("mainnet", undefined, null)).toBeNull();
    expect(mempoolTxUrl("mainnet", undefined, undefined)).toBeNull();
    expect(mempoolTxUrl("mainnet", undefined, "")).toBeNull();
  });

  it("builds mainnet urls", () => {
    expect(mempoolTxUrl("mainnet", undefined, "abc")).toBe(
      "https://mempool.space/tx/abc",
    );
  });

  it("builds testnet urls", () => {
    expect(mempoolTxUrl("testnet", undefined, "abc")).toBe(
      "https://mempool.space/testnet/tx/abc",
    );
  });

  it("builds signet urls", () => {
    expect(mempoolTxUrl("testnet", "signet", "abc")).toBe(
      "https://mempool.space/signet/tx/abc",
    );
  });
});

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;

  it("returns Never for null", () => {
    expect(formatRelativeTime(null, now)).toBe("Never");
  });

  it("returns just now for sub-10s (including future/negative deltas)", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    expect(formatRelativeTime(now + 5_000, now)).toBe("just now");
  });

  it("returns seconds", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("30 sec ago");
  });

  it("returns minutes", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
  });

  it("returns hours", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 hr ago");
  });

  it("returns singular and plural days", () => {
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe("1 day ago");
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe("3 days ago");
  });

  it("defaults now to Date.now()", () => {
    expect(formatRelativeTime(Date.now())).toBe("just now");
  });
});

// ─── satsToUsd ────────────────────────────────────────────────────────────────

describe("satsToUsd", () => {
  it("returns null without a usable price", () => {
    expect(satsToUsd(1000, null)).toBeNull();
    expect(satsToUsd(1000, undefined)).toBeNull();
    expect(satsToUsd(1000, Number.NaN)).toBeNull();
    expect(satsToUsd(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null when sats is not finite", () => {
    expect(satsToUsd(Number.NaN, 100_000)).toBeNull();
    expect(satsToUsd(Number.POSITIVE_INFINITY, 100_000)).toBeNull();
  });

  it("computes usd from sats", () => {
    expect(satsToUsd(100_000_000, 100_000)).toBe(100_000);
    expect(satsToUsd(0, 100_000)).toBe(0);
  });
});

// ─── formatUsd ────────────────────────────────────────────────────────────────

describe("formatUsd", () => {
  it("returns null without a price", () => {
    expect(formatUsd(1000, null)).toBeNull();
  });

  it("formats a normal amount to two decimals", () => {
    // 1000 sats * 100000 usd/btc / 1e8 = $1.00
    expect(formatUsd(1000, 100_000)).toBe("$1.00");
  });

  it("keeps extra precision for sub-cent values", () => {
    // 3 sats * 100000 / 1e8 = $0.003
    expect(formatUsd(3, 100_000)).toBe("$0.003");
  });

  it("formats zero as $0.00", () => {
    expect(formatUsd(0, 100_000)).toBe("$0.00");
  });

  it("formats negative amounts", () => {
    expect(formatUsd(-1000, 100_000)).toBe("-$1.00");
  });
});

// ─── formatSats ───────────────────────────────────────────────────────────────

describe("formatSats", () => {
  it("rounds and returns a grouped integer", () => {
    expect(formatSats(3450).replace(/[^0-9]/g, "")).toBe("3450");
    expect(formatSats(3450.4).replace(/[^0-9]/g, "")).toBe("3450");
    expect(formatSats(3450.6).replace(/[^0-9]/g, "")).toBe("3451");
    expect(formatSats(0)).toBe("0");
  });
});

// ─── mempoolApiBase ───────────────────────────────────────────────────────────

describe("mempoolApiBase", () => {
  it("returns the mainnet api base", () => {
    expect(mempoolApiBase("mainnet", undefined)).toBe(
      "https://mempool.space/api",
    );
  });

  it("returns the signet api base", () => {
    expect(mempoolApiBase("testnet", "signet")).toBe(
      "https://mempool.space/signet/api",
    );
  });

  it("returns the testnet api base", () => {
    expect(mempoolApiBase("testnet", undefined)).toBe(
      "https://mempool.space/testnet/api",
    );
  });
});

// ─── CLIENT_NOT_INITIALIZED ───────────────────────────────────────────────────

describe("CLIENT_NOT_INITIALIZED", () => {
  it("is the expected message", () => {
    expect(CLIENT_NOT_INITIALIZED).toBe(
      "Client not initialized — please log in first",
    );
  });
});

// ─── cx ───────────────────────────────────────────────────────────────────────

describe("cx", () => {
  it("joins truthy class names", () => {
    expect(cx("a", "b", "c")).toBe("a b c");
  });

  it("filters falsy values", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("returns undefined when nothing is truthy", () => {
    expect(cx(false, null, undefined, "")).toBeUndefined();
    expect(cx()).toBeUndefined();
  });
});
