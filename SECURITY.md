# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report them privately via
[GitHub Security Advisories](https://github.com/UnspendableLabs/Horizon-Market-Client/security/advisories/new)
for this repository. We aim to acknowledge reports within 72 hours.

## Scope

This SDK signs Bitcoin transactions locally. Reports we care most about:

- Private key, mnemonic, or keystore-password exposure (logs, errors, network
  requests, insecure storage)
- Signing flaws — signing inputs the user did not approve, incorrect sighash
  usage, PSBT tampering that survives validation
- Cryptographic misuse in `src/crypto/**` (keystore encryption, BIP322, key
  derivation)
- The `horizon` CLI keystore handling (`apps/cli`)

## Supported versions

Only the latest published release receives security fixes.

## Design guarantees worth knowing

- Private keys never leave the client: write operations send only signed PSBTs,
  signed transactions, or BIP322 signatures to the API.
- The CLI stores the mnemonic exclusively inside an encrypted keystore file
  (scrypt + AES-256-GCM, `0600` permissions); read-only commands never unlock it.
