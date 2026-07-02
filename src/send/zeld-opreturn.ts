import * as btc from "bitcoinjs-lib";

/**
 * ZELD custom-distribution OP_RETURN codec.
 *
 * A ZELD transfer moves the token via an OP_RETURN carrying `"ZELD"` + a
 * canonical-CBOR `Vec<u64>`: each entry is how many ZELD go to the corresponding
 * non-OP_RETURN output, in output order. Ported ~verbatim from Horizon Market's
 * `src/modules/zeldhash/lib/zeld-opreturn.ts` (depends only on bitcoinjs-lib).
 */

/** 4-byte ASCII prefix that marks a ZELD custom-distribution OP_RETURN. */
const ZELD_PREFIX = Buffer.from("ZELD", "ascii");

/** Maximum data carried by a standard (relayable) OP_RETURN output. */
export const MAX_OP_RETURN_PAYLOAD_BYTES = 80;

/**
 * Encode a `Vec<u64>` as canonical CBOR (definite-length array of unsigned
 * integers, minimal width per value). Matches the encoding the ZeldHash indexer
 * decodes. Hand-rolled to avoid any ambiguity from a general CBOR library.
 */
export function encodeZeldDistributionCbor(distribution: bigint[]): Buffer {
  const parts: Buffer[] = [cborArrayHeader(distribution.length)];
  for (const value of distribution) {
    if (value < 0n) {
      throw new Error("ZELD distribution values must be non-negative");
    }
    if (value > 0xffffffffffffffffn) {
      throw new Error("ZELD distribution values must fit in u64");
    }
    parts.push(cborUint(value));
  }
  return Buffer.concat(parts);
}

/** Build the OP_RETURN output script: OP_RETURN <push>("ZELD" || CBOR(dist)). */
export function buildZeldOpReturnScript(distribution: bigint[]): Buffer {
  const payload = Buffer.concat([
    ZELD_PREFIX,
    encodeZeldDistributionCbor(distribution),
  ]);
  if (payload.length > MAX_OP_RETURN_PAYLOAD_BYTES) {
    throw new Error(
      `ZELD OP_RETURN payload is ${payload.length} bytes, exceeds the ` +
        `${MAX_OP_RETURN_PAYLOAD_BYTES}-byte standard limit (too many outputs)`,
    );
  }
  return Buffer.from(
    btc.script.compile([btc.opcodes.OP_RETURN, new Uint8Array(payload)]),
  );
}

/**
 * Decode the `Vec<u64>` distribution carried by a ZELD OP_RETURN output script,
 * or `null` when `script` is not a well-formed ZELD OP_RETURN. Inverse of
 * {@link buildZeldOpReturnScript}.
 */
export function decodeZeldOpReturnScript(script: Uint8Array): bigint[] | null {
  let chunks: ReturnType<typeof btc.script.decompile>;
  try {
    // bitcoinjs-lib's ESM build rejects a Node Buffer here, so normalise.
    chunks = btc.script.decompile(Uint8Array.from(script));
  } catch {
    return null;
  }
  if (!chunks || chunks.length < 2) return null;
  if (chunks[0] !== btc.opcodes.OP_RETURN) return null;

  const payload = chunks[1];
  if (typeof payload === "number") return null;
  const buf = Buffer.from(payload);
  if (buf.length < ZELD_PREFIX.length) return null;
  if (!buf.subarray(0, ZELD_PREFIX.length).equals(ZELD_PREFIX)) return null;

  try {
    return decodeZeldDistributionCbor(buf.subarray(ZELD_PREFIX.length));
  } catch {
    return null;
  }
}

/** Inverse of {@link encodeZeldDistributionCbor}: decode a canonical `Vec<u64>`. */
export function decodeZeldDistributionCbor(buf: Buffer): bigint[] {
  let offset = 0;

  const readHead = (expectedMajor: number): bigint => {
    if (offset >= buf.length) {
      throw new Error("ZELD CBOR: unexpected end of buffer");
    }
    const initial = buf[offset++];
    if ((initial & 0xe0) !== expectedMajor) {
      throw new Error("ZELD CBOR: unexpected major type");
    }
    const info = initial & 0x1f;
    if (info < 24) return BigInt(info);
    if (info === 24) {
      if (offset + 1 > buf.length) throw new Error("ZELD CBOR: truncated u8");
      return BigInt(buf[offset++]);
    }
    if (info === 25) {
      if (offset + 2 > buf.length) throw new Error("ZELD CBOR: truncated u16");
      const v = buf.readUInt16BE(offset);
      offset += 2;
      return BigInt(v);
    }
    if (info === 26) {
      if (offset + 4 > buf.length) throw new Error("ZELD CBOR: truncated u32");
      const v = buf.readUInt32BE(offset);
      offset += 4;
      return BigInt(v);
    }
    if (info === 27) {
      if (offset + 8 > buf.length) throw new Error("ZELD CBOR: truncated u64");
      const v = buf.readBigUInt64BE(offset);
      offset += 8;
      return v;
    }
    throw new Error("ZELD CBOR: unsupported additional info");
  };

  const length = Number(readHead(0x80)); // array header
  const out: bigint[] = [];
  for (let i = 0; i < length; i++) {
    out.push(readHead(0x00)); // unsigned integer
  }
  if (offset !== buf.length) {
    throw new Error("ZELD CBOR: trailing bytes after distribution");
  }
  return out;
}

/** CBOR major type 4 (array) header for a given length. */
function cborArrayHeader(length: number): Buffer {
  return cborTypedHead(0x80, BigInt(length));
}

/** CBOR major type 0 (unsigned integer). */
function cborUint(value: bigint): Buffer {
  return cborTypedHead(0x00, value);
}

/**
 * Encode a CBOR head for `majorType` (0x00 unsigned int, 0x80 array) carrying
 * `value`, using the minimal-width additional-information encoding.
 */
function cborTypedHead(majorType: number, value: bigint): Buffer {
  if (value < 24n) {
    return Buffer.from([majorType | Number(value)]);
  }
  if (value <= 0xffn) {
    return Buffer.from([majorType | 24, Number(value)]);
  }
  if (value <= 0xffffn) {
    const b = Buffer.alloc(3);
    b[0] = majorType | 25;
    b.writeUInt16BE(Number(value), 1);
    return b;
  }
  if (value <= 0xffffffffn) {
    const b = Buffer.alloc(5);
    b[0] = majorType | 26;
    b.writeUInt32BE(Number(value), 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = majorType | 27;
  b.writeBigUInt64BE(value, 1);
  return b;
}
