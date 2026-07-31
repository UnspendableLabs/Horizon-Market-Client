import fs from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { bigintReplacer, CliError, errorCode, runCommand } from "./output.js";

describe("bigintReplacer", () => {
  it("serializes bigint values to decimal strings", () => {
    const json = JSON.stringify(
      { a: 1n, b: { c: 9007199254740993n }, d: [2n, 3n], e: "x", f: 4 },
      bigintReplacer,
    );
    expect(JSON.parse(json)).toEqual({
      a: "1",
      b: { c: "9007199254740993" },
      d: ["2", "3"],
      e: "x",
      f: 4,
    });
  });
});

describe("CliError", () => {
  it("is an Error carrying an optional machine-readable code", () => {
    const err = new CliError("boom", "E_BOOM");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CliError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("E_BOOM");
    expect(new CliError("no code").code).toBeUndefined();
  });
});

describe("runCommand (JSON envelope)", () => {
  // In the test runner stdout is not a TTY, so runCommand is always in JSON mode.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the JSON payload to stdout on success (bigints as strings)", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runCommand({ json: true }, () =>
      Promise.resolve({ json: { ok: true, sats: 10n }, human: () => undefined }),
    );
    const written = out.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(written)).toEqual({ ok: true, sats: "10" });
  });

  // Errors are emitted through fs.writeSync(2, …), not process.stderr.write —
  // stderr pipe writes are async on macOS/Windows and would be lost on exit(1).
  it("writes {error:{message,code}} to stderr and exits 1 on a CliError", async () => {
    const err = vi.spyOn(fs, "writeSync").mockReturnValue(0);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    await runCommand({ json: true }, () =>
      Promise.reject(new CliError("nope", "E_NOPE")),
    );
    const written = err.mock.calls.map((c) => String(c[1])).join("");
    expect(err.mock.calls[0]?.[0]).toBe(2);
    expect(JSON.parse(written)).toEqual({ error: { message: "nope", code: "E_NOPE" } });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("omits code when the error is not a CliError", async () => {
    const err = vi.spyOn(fs, "writeSync").mockReturnValue(0);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await runCommand({ json: true }, () => Promise.reject(new Error("plain")));
    const written = err.mock.calls.map((c) => String(c[1])).join("");
    expect(JSON.parse(written)).toEqual({ error: { message: "plain" } });
  });

  // The SDK's pre-flight refusals are the ones a script most needs to tell
  // apart: "fund the account and retry" vs "the chain already moved".
  it("codes a Kontor pre-flight refusal so --json consumers needn't grep the message", async () => {
    const err = vi.spyOn(fs, "writeSync").mockReturnValue(0);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const gas = new Error("Not enough KOR to pay Kontor network gas.");
    gas.name = "KontorInsufficientGasError";
    await runCommand({ json: true }, () => Promise.reject(gas));
    const written = err.mock.calls.map((c) => String(c[1])).join("");
    expect(JSON.parse(written).error.code).toBe("KONTOR_INSUFFICIENT_GAS");
  });
});

describe("errorCode", () => {
  it("maps the SDK's Kontor errors and leaves unknown ones uncoded", () => {
    const escrow = new Error("unbacked");
    escrow.name = "KontorEscrowNotFundedError";
    expect(errorCode(escrow)).toBe("KONTOR_ESCROW_NOT_FUNDED");

    const recorded = new Error("already broadcast");
    recorded.name = "KontorPurchaseNotRecordedError";
    expect(errorCode(recorded)).toBe("KONTOR_PURCHASE_NOT_RECORDED");

    expect(errorCode(new Error("plain"))).toBeUndefined();
    expect(errorCode("not an error")).toBeUndefined();
  });

  it("keeps a CliError's own code, which wins over the name map", () => {
    expect(errorCode(new CliError("x", "E_X"))).toBe("E_X");
    expect(errorCode(new CliError("x"))).toBeUndefined();
  });
});
