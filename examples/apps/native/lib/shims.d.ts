// Ambient declarations for the pure-JS Node crypto shims that lib/polyfills.ts
// attaches to globalThis.crypto (so @web3auth's ECIES session layer finds
// createHash/createHmac/createCipheriv). These packages ship no type
// definitions; declaring them keeps the `require(...)` calls type-clean under
// `strict`.
declare module "create-hash";
declare module "create-hmac";
declare module "browserify-aes";
