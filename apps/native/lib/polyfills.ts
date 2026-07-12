/**
 * Crypto / Node-shim polyfills for React Native.
 *
 * MUST be imported as the VERY FIRST line of App.tsx — before any bitcoinjs,
 * @web3auth, or SDK import — so `global.Buffer`, a CSPRNG-backed
 * `crypto.getRandomValues`, and `TextEncoder`/`TextDecoder` exist before those
 * modules initialize.
 *
 * The web app's main.tsx only shims Buffer because the browser already provides
 * crypto, TextEncoder/TextDecoder and btoa/atob natively. Hermes (RN's engine)
 * provides none of them, so this file fills every gap the crypto stack hits.
 */

// Installs crypto.getRandomValues backed by the native secure RNG. Imported for
// its side effect — keep this before anything that derives keys / signs.
import "react-native-get-random-values";

// Pure-JS `buffer` (base64-js under the hood), NOT @craftzdog/react-native-buffer:
// the latter depends on react-native-quick-base64, a C++ TurboModule that only
// registers under the New Architecture. This app runs the old architecture
// (newArchEnabled=false), so importing it throws at startup
// (`TurboModuleRegistry.getEnforcing('QuickBase64') could not be found`) — a
// white-screen crash on the very first polyfill import. Plain `buffer` runs on
// Hermes with no native module and is API-compatible for bitcoinjs / @web3auth.
import { Buffer } from "buffer";

// bitcoinjs-lib + @web3auth expect a global Buffer (Node-style). RN has none.
const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  TextEncoder?: unknown;
  TextDecoder?: unknown;
  btoa?: (data: string) => string;
  atob?: (data: string) => string;
  process?: {
    version?: string;
    nextTick?: (cb: (...a: unknown[]) => void, ...a: unknown[]) => void;
  };
};
if (!g.Buffer) {
  g.Buffer = Buffer;
}

// The Node-stream libraries the bitcoin/web3auth chains pull in read fields off the
// *global* `process` at module load (the metro `process` alias only rewrites
// `require('process')`, not the global). RN's global process has neither, so:
//   • readable-stream v2 (hash-base → create-hash): `process.version.slice(0, 5)`
//     → `Cannot read property 'slice' of undefined`
//   • end-of-stream (@web3auth/auth): `process.nextTick.bind(process)`
//     → `Cannot read property 'bind' of undefined`
// Both are white-screen crashes at startup. Provide just these two, guarded — and
// nothing else on `process`: this runs before RN's InitializeCore, and touching
// process.browser / a microtask-based nextTick there wedges RN's own timer/promise
// setup (the app then dies with "AppRegistry ... n = 0"). Defer nextTick via
// setImmediate (a macrotask that yields to the event loop, like browserify's shim).
const proc = (g.process ??= {});
if (typeof proc.version !== "string") proc.version = "";
if (typeof proc.nextTick !== "function") {
  proc.nextTick = (cb, ...args) => {
    setImmediate(() => cb(...args));
  };
}

// @noble/hashes' utf8ToBytes / bytesToUtf8 (reached by the whole bitcoin crypto
// stack) call `new TextEncoder()` / `new TextDecoder()`. Hermes ships neither, so
// simply *using* the crypto stack throws `ReferenceError: Property 'TextDecoder'
// doesn't exist` at startup. Install minimal, correct UTF-8-only implementations
// (guarded, so they no-op on any engine that already provides them).
if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class TextEncoder {
    readonly encoding = "utf-8";
    encode(input = ""): Uint8Array {
      const str = String(input);
      const bytes: number[] = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        // Combine a UTF-16 surrogate pair into one code point.
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          const next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
            i++;
          }
        }
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
        }
      }
      return Uint8Array.from(bytes);
    }
  };
}

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class TextDecoder {
    readonly encoding = "utf-8";
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return "";
      const bytes =
        input instanceof Uint8Array
          ? input
          : new Uint8Array("buffer" in input ? input.buffer : input);
      let out = "";
      let i = 0;
      while (i < bytes.length) {
        let code = bytes[i++];
        if (code >= 0xc0 && code < 0xe0) {
          code = ((code & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (code >= 0xe0 && code < 0xf0) {
          code = ((code & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (code >= 0xf0) {
          code =
            ((code & 0x07) << 18) |
            ((bytes[i++] & 0x3f) << 12) |
            ((bytes[i++] & 0x3f) << 6) |
            (bytes[i++] & 0x3f);
        }
        if (code > 0xffff) {
          code -= 0x10000;
          out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
        } else {
          out += String.fromCharCode(code);
        }
      }
      return out;
    }
  };
}

// @web3auth / torus base64-encode JSON payloads via the browser's btoa/atob.
// Hermes has neither; back them with Buffer (now global above). Guarded so they
// no-op where the engine already provides them.
if (typeof g.btoa === "undefined") {
  g.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof g.atob === "undefined") {
  g.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}

// @web3auth's session layer (@toruslabs/session-manager → @toruslabs/eccrypto)
// wraps every login/session payload in ECIES. eccrypto reads Node-style crypto
// off the GLOBAL `crypto`:
//   const browserCrypto = globalThis.crypto || {};
//   const subtle = browserCrypto.subtle || browserCrypto.webkitSubtle;   // undefined on Hermes
//   if (!browserCrypto.createHash) { …await subtle.digest("SHA-512", msg)… }
// react-native-get-random-values installs `crypto.getRandomValues` and nothing
// else, and Hermes has no `crypto.subtle`, so `subtle` is undefined. The instant
// Web3Auth builds a login session — on the first "Connect" tap, BEFORE the browser
// even opens — eccrypto hits `subtle.digest` on that undefined `subtle`:
// "Cannot read property 'digest' of undefined". Attach the exact pure-JS Node
// primitives eccrypto needs — SHA-512 hash, HMAC-SHA256, AES-256-CBC cipher — so
// it takes the createHash/createHmac/createCipheriv branch and never touches
// SubtleCrypto. Guarded so it no-ops if a real implementation ever appears.
//
// NB: require(), not a top-level import. These packages pull in readable-stream,
// which reads `process.version` at module-eval time (see the process shim above)
// — so they must load AFTER that shim runs, not during the hoisted-import phase.
const cryptoObj = globalThis.crypto as unknown as
  | Record<string, unknown>
  | undefined;
if (cryptoObj && typeof cryptoObj.createHash !== "function") {
  // require (not import) is deliberate here — deferring these to run AFTER the
  // process shim above, not at the hoisted-import phase — so the rule is off.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const createHash = require("create-hash");
  const createHmac = require("create-hmac");
  const { createCipheriv, createDecipheriv } = require("browserify-aes");
  /* eslint-enable @typescript-eslint/no-require-imports */
  cryptoObj.createHash = createHash;
  cryptoObj.createHmac = createHmac;
  cryptoObj.createCipheriv = createCipheriv;
  cryptoObj.createDecipheriv = createDecipheriv;
}
