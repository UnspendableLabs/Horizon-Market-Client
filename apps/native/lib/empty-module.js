// Stub for Node-only core modules (node:fs, node:path, …) that get pulled into
// the Metro graph via @kontor/sdk. Kontor is WASM-backed and inert on Hermes
// (see metro.config.js / the SDK's lazy-load guard), so these are never actually
// executed on native — they only need to resolve so the bundle can build.
module.exports = {};
module.exports.default = {};
