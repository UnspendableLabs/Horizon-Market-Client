import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { resolveContext } from "./context.js";

describe("resolveContext", () => {
  let savedHome: string | undefined;
  beforeEach(() => {
    savedHome = process.env.HORIZON_HOME;
    delete process.env.HORIZON_HOME;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HORIZON_HOME;
    else process.env.HORIZON_HOME = savedHome;
  });

  it("defaults homeDir to ~/.horizon", () => {
    const cli = resolveContext({});
    expect(cli.homeDir).toBe(path.join(os.homedir(), ".horizon"));
  });

  it("prefers --home over $HORIZON_HOME", () => {
    process.env.HORIZON_HOME = "/tmp/from-env";
    const cli = resolveContext({ home: "/tmp/from-flag" });
    expect(cli.homeDir).toBe(path.resolve("/tmp/from-flag"));
  });

  it("uses $HORIZON_HOME when no --home flag is given", () => {
    process.env.HORIZON_HOME = "/tmp/from-env";
    expect(resolveContext({}).homeDir).toBe(path.resolve("/tmp/from-env"));
  });

  it("parses a valid --network override", () => {
    expect(resolveContext({ network: "signet" }).networkOverride).toBe("signet");
    expect(resolveContext({ network: "mainnet" }).networkOverride).toBe("mainnet");
    expect(resolveContext({}).networkOverride).toBeUndefined();
  });

  it("rejects an invalid --network", () => {
    expect(() => resolveContext({ network: "regtest" })).toThrowError(/Invalid --network/);
  });

  it("carries autoConfirm and feeRate through", () => {
    const cli = resolveContext({ "auto-confirm": true, "fee-rate": "fast" });
    expect(cli.autoConfirm).toBe(true);
    expect(cli.feeRate).toBe("fast");
  });

  describe("passphrase resolution", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.HORIZON_PASSPHRASE;
      delete process.env.HORIZON_PASSPHRASE;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.HORIZON_PASSPHRASE;
      else process.env.HORIZON_PASSPHRASE = saved;
    });

    it("is undefined without a flag or env var", () => {
      expect(resolveContext({}).passphrase).toBeUndefined();
    });

    it("reads the --passphrase flag", () => {
      expect(resolveContext({ passphrase: "hunter2" }).passphrase).toBe("hunter2");
    });

    it("falls back to $HORIZON_PASSPHRASE", () => {
      process.env.HORIZON_PASSPHRASE = "from-env";
      expect(resolveContext({}).passphrase).toBe("from-env");
    });

    it("prefers --passphrase over $HORIZON_PASSPHRASE", () => {
      process.env.HORIZON_PASSPHRASE = "from-env";
      expect(resolveContext({ passphrase: "from-flag" }).passphrase).toBe("from-flag");
    });
  });
});
