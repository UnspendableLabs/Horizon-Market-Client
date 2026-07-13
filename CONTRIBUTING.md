# Contributing

Thanks for your interest in improving the Horizon Market client!

## Repository layout

| Path | What it is |
|------|------------|
| `src/` | The SDK (`@unspendablelabs/horizon-market-client`) — core client, crypto, workflows, and the React/React Native UI layer |
| `apps/cli/` | The `horizon` CLI — shipped as the package `bin`, built from here |
| `apps/web/` | Vite + React example app (Web3Auth login, market, wallet) |
| `apps/native/` | Expo / React Native example app |
| `examples/` | Small runnable SDK scripts (`npx tsx examples/sell.ts`) |

## Development setup

Node ≥ 20 is required.

```bash
npm install
npm run build       # dual ESM/CJS build + the CLI bin (dist/)
npm test            # vitest, src/**/*.test.ts
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src examples apps/cli/src
```

The CLI consumes the SDK's built `dist/` via a `file:../..` dependency, so build
the SDK before working on it:

```bash
cd apps/cli
npm install
npm test && npm run typecheck
```

`npm run dev` at the root keeps `dist/` rebuilt on change (the native example
also reads `dist/`, not `src/`).

## Before opening a PR

1. `npm run typecheck && npm run lint && npm test` must pass at the root.
2. If you touched `apps/cli`, run its `npm test` + `npm run typecheck` too.
3. Add or update tests for behavior changes — the suite is fast, keep it that way.
4. Update `CHANGELOG.md` (Keep a Changelog format) for anything user-visible.
5. Follow the existing code style; `npm run format` runs Prettier over `src/`.

CI runs typecheck, tests (with coverage), lint, build, and the CLI suite on every
pull request.

## Security-sensitive code

Key handling (`src/crypto/**`), PSBT signing, and the CLI keystore live behind
extra scrutiny: private keys and mnemonics must never be logged, serialized into
errors, or sent over the network. If your change touches these paths, call it
out explicitly in the PR description. For vulnerabilities, see
[SECURITY.md](SECURITY.md) — please do not open public issues for them.
