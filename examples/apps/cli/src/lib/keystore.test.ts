import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeKeystore,
  readKeystore,
  requireKeystore,
  keystoreExists,
  keystorePath,
  type StoredKeystore,
} from "./keystore.js";

const isPosix = process.platform !== "win32";

function fixture(overrides: Partial<StoredKeystore> = {}): StoredKeystore {
  return {
    version: 1,
    network: "signet",
    path: "m/86'/0'/0'/0/0",
    publicKey: "02" + "ab".repeat(32),
    xOnlyPubkey: "ab".repeat(32),
    addresses: {
      mainnet: { p2wpkh: "bc1qmain", p2tr: "bc1pmain" },
      testnet: { p2wpkh: "tb1qtest", p2tr: "tb1ptest" },
    },
    createdAt: "2026-07-08T12:00:00.000Z",
    keystore: '{"version":1,"cipher":"aes-256-gcm"}',
    ...overrides,
  };
}

describe("keystore file I/O", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "horizon-cli-"));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips a keystore record", () => {
    const ks = fixture();
    writeKeystore(home, ks);
    expect(keystoreExists(home)).toBe(true);
    expect(readKeystore(home)).toEqual(ks);
  });

  it("returns null / throws when no keystore exists", () => {
    expect(keystoreExists(home)).toBe(false);
    expect(readKeystore(home)).toBeNull();
    expect(() => requireKeystore(home)).toThrow(/init/);
  });

  it("creates the dir 0700 and the file 0600", () => {
    writeKeystore(home, fixture());
    if (isPosix) {
      expect(fs.statSync(home).mode & 0o777).toBe(0o700);
      expect(fs.statSync(keystorePath(home)).mode & 0o777).toBe(0o600);
    }
  });

  it("writes atomically, leaving no temp files behind", () => {
    writeKeystore(home, fixture());
    const leftover = fs.readdirSync(home).filter((f) => f.endsWith(".tmp"));
    expect(leftover).toEqual([]);
    expect(fs.readdirSync(home)).toEqual(["keystore.json"]);
  });

  it("overwrites an existing keystore (and keeps 0600)", () => {
    writeKeystore(home, fixture({ createdAt: "2026-01-01T00:00:00.000Z" }));
    writeKeystore(home, fixture({ createdAt: "2026-07-08T12:00:00.000Z" }));
    expect(readKeystore(home)?.createdAt).toBe("2026-07-08T12:00:00.000Z");
    if (isPosix) {
      expect(fs.statSync(keystorePath(home)).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects corrupt JSON", () => {
    fs.writeFileSync(keystorePath(home), "{not json", { mode: 0o600 });
    expect(() => readKeystore(home)).toThrow(/Corrupt keystore/);
  });

  it("rejects an unrecognized format (wrong version)", () => {
    fs.writeFileSync(
      keystorePath(home),
      JSON.stringify({ ...fixture(), version: 2 }),
      { mode: 0o600 },
    );
    expect(() => readKeystore(home)).toThrow(/Unrecognized keystore format/);
  });
});
