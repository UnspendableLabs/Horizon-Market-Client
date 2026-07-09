import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isUiNetwork,
  getNetworkConfig,
  mempoolApiBase,
  mempoolTxUrl,
} from "./networks.js";

const ENV_KEYS = [
  "HORIZON_MARKET_URL",
  "HORIZON_ORD_API_URL",
  "HORIZON_COUNTERPARTY_API_URL",
  "HORIZON_ZELD_API_URL",
  "HORIZON_KONTOR_INDEXER_URL",
  "HORIZON_KONTOR_NFT_CONTRACT",
  "HORIZON_MARKET_URL_SIGNET",
  "HORIZON_ORD_API_URL_SIGNET",
  "HORIZON_COUNTERPARTY_API_URL_SIGNET",
  "HORIZON_ZELD_API_URL_SIGNET",
  "HORIZON_KONTOR_INDEXER_URL_SIGNET",
  "HORIZON_KONTOR_NFT_CONTRACT_SIGNET",
];

describe("isUiNetwork", () => {
  it("accepts only mainnet / signet", () => {
    expect(isUiNetwork("mainnet")).toBe(true);
    expect(isUiNetwork("signet")).toBe(true);
    expect(isUiNetwork("testnet")).toBe(false);
    expect(isUiNetwork(null)).toBe(false);
    expect(isUiNetwork(undefined)).toBe(false);
  });
});

describe("getNetworkConfig", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("maps mainnet to its default endpoints (SDK network = mainnet)", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(cfg.sdkNetwork).toBe("mainnet");
    expect(cfg.kontorNetwork).toBeUndefined();
    expect(cfg.baseUrl).toBe("https://horizon.market");
    expect(cfg.counterpartyApiBaseUrl).toBe("https://api.counterparty.io:4000");
    expect(cfg.zeldApiBaseUrl).toBe("https://api.zeldhash.com");
    expect(cfg.ordApiBaseUrl).toBe("https://api.counterparty.io:7000");
  });

  it("maps signet to testnet + kontorNetwork signet with no ZELD default", () => {
    const cfg = getNetworkConfig("signet");
    expect(cfg.sdkNetwork).toBe("testnet");
    expect(cfg.kontorNetwork).toBe("signet");
    expect(cfg.baseUrl).toBe("https://signet.horizon.market");
    expect(cfg.counterpartyApiBaseUrl).toBe("https://signet.counterparty.io:34000");
    expect(cfg.kontorIndexerUrl).toBe("https://signet.kontor.network:35100");
    // ZELD is mainnet-only — no signet default.
    expect(cfg.zeldApiBaseUrl).toBeUndefined();
  });

  it("applies env overrides and treats blank env as unset", () => {
    process.env.HORIZON_MARKET_URL = "https://example.test";
    process.env.HORIZON_COUNTERPARTY_API_URL = "   "; // whitespace → ignored
    const cfg = getNetworkConfig("mainnet");
    expect(cfg.baseUrl).toBe("https://example.test");
    expect(cfg.counterpartyApiBaseUrl).toBe("https://api.counterparty.io:4000");
  });
});

describe("mempoolApiBase / mempoolTxUrl", () => {
  it("uses mainnet endpoints for the mainnet config", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(mempoolApiBase(cfg)).toBe("https://mempool.space/api");
    expect(mempoolTxUrl(cfg, "abc")).toBe("https://mempool.space/tx/abc");
  });

  it("uses signet endpoints for the signet config", () => {
    const cfg = getNetworkConfig("signet");
    expect(mempoolApiBase(cfg)).toBe("https://mempool.space/signet/api");
    expect(mempoolTxUrl(cfg, "abc")).toBe("https://mempool.space/signet/tx/abc");
  });

  it("returns null tx url without a txid", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(mempoolTxUrl(cfg, null)).toBeNull();
    expect(mempoolTxUrl(cfg, undefined)).toBeNull();
  });
});
