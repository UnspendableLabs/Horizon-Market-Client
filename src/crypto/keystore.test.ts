import { describe, it, expect } from "vitest";
import { encryptKeystore, decryptKeystore, type Keystore } from "./keystore.js";

// Low scrypt cost keeps the test fast; the round-trip semantics are identical.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

const SECRET =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = "correct horse battery staple";

describe("encryptKeystore / decryptKeystore", () => {
  it("round-trips a secret", async () => {
    const blob = await encryptKeystore(SECRET, PASSWORD, FAST);
    expect(await decryptKeystore(blob, PASSWORD)).toBe(SECRET);
  });

  it("emits a self-describing v1 scrypt/aes-256-gcm keystore", async () => {
    const ks = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    expect(ks.version).toBe(1);
    expect(ks.kdf.name).toBe("scrypt");
    expect(ks.kdf.N).toBe(FAST.N);
    expect(ks.cipher).toBe("aes-256-gcm");
    expect(ks.kdf.salt).toMatch(/^[0-9a-f]+$/);
    expect(ks.iv).toMatch(/^[0-9a-f]{24}$/); // 12-byte GCM nonce
    expect(ks.ciphertext).toMatch(/^[0-9a-f]+$/);
  });

  it("uses a fresh salt + iv on every call (distinct ciphertexts)", async () => {
    const a = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    const b = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("round-trips a unicode + long secret", async () => {
    const secret = "🔐 clé-privée café ☃ " + "x".repeat(4096);
    const blob = await encryptKeystore(secret, PASSWORD, FAST);
    expect(await decryptKeystore(blob, PASSWORD)).toBe(secret);
  });

  it("throws on the wrong password (GCM tag mismatch)", async () => {
    const blob = await encryptKeystore(SECRET, PASSWORD, FAST);
    await expect(decryptKeystore(blob, "wrong password")).rejects.toThrow(
      /wrong password or corrupt data/,
    );
  });

  it("throws when the ciphertext is tampered with", async () => {
    const ks = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    // Flip the last hex nibble of the ciphertext (covers the auth tag region).
    const last = ks.ciphertext.slice(-1);
    const flipped = last === "0" ? "1" : "0";
    ks.ciphertext = ks.ciphertext.slice(0, -1) + flipped;
    await expect(decryptKeystore(JSON.stringify(ks), PASSWORD)).rejects.toThrow(
      /wrong password or corrupt data/,
    );
  });

  it("throws when the iv is tampered with", async () => {
    const ks = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    const last = ks.iv.slice(-1);
    ks.iv = ks.iv.slice(0, -1) + (last === "0" ? "1" : "0");
    await expect(decryptKeystore(JSON.stringify(ks), PASSWORD)).rejects.toThrow(
      /wrong password or corrupt data/,
    );
  });

  it("rejects malformed JSON", async () => {
    await expect(decryptKeystore("{not json", PASSWORD)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("rejects an unsupported KDF or cipher", async () => {
    const base = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    const badKdf = { ...base, kdf: { ...base.kdf, name: "pbkdf2" } };
    await expect(decryptKeystore(JSON.stringify(badKdf), PASSWORD)).rejects.toThrow(
      /Unsupported KDF/,
    );
    const badCipher = { ...base, cipher: "aes-128-cbc" };
    await expect(decryptKeystore(JSON.stringify(badCipher), PASSWORD)).rejects.toThrow(
      /Unsupported cipher/,
    );
  });

  it("rejects an unsupported version", async () => {
    const ks = JSON.parse(await encryptKeystore(SECRET, PASSWORD, FAST)) as Keystore;
    ks.version = 2;
    await expect(decryptKeystore(JSON.stringify(ks), PASSWORD)).rejects.toThrow(
      /Unsupported keystore version/,
    );
  });
});
