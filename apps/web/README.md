# Horizon Market — Web Example

A Vite + React SPA demonstrating the `@unspendablelabs/horizon-market-client`
library (Web3Auth login + swap list).

## Local development

```bash
# from the repo root: build the library once so the file: dependency resolves
npm install && npm run build

cd apps/web
npm install
npm run dev
```

Environment variables live in `.env.local` (gitignored). See the keys below.

## Deploying to Vercel

This example depends on the parent library via `"@unspendablelabs/horizon-market-client": "file:../.."`.
The library is **not** published to npm, so Vercel must build it from source
during the deploy. That is wired up in [`vercel.json`](./vercel.json):

```jsonc
{
  "framework": "vite",
  // install web deps, then the library's deps (cwd = repo root → honors root .npmrc)
  "installCommand": "npm install && (cd ../.. && npm install)",
  // build the library first (creates its dist/), then build this app
  "buildCommand": "(cd ../.. && npm run build) && npm run build"
}
```

### One-time Vercel project settings (dashboard)

These are **Project Settings** and cannot be expressed in `vercel.json`:

1. **Root Directory** → `apps/web`
2. **Include source files outside of the Root Directory in the Build Step** →
   **ON** (required — the `file:../..` dependency and the `cd ../..` build
   step need the full repo checked out).
3. **Node.js Version** → `20.x` (matches the library's `engines.node >= 20`).
4. Leave the dashboard **Build / Install Command** fields blank so the committed
   `vercel.json` is used.

### Environment variables

Add these (build-time, `VITE_`-prefixed, inlined by Vite) for **Production** and
**Preview**. A redeploy is required after changing any of them.

| Key                       | Value (from `.env.local`)                  |
| ------------------------- | ------------------------------------------ |
| `VITE_HORIZON_MARKET_URL` | `https://horizon.market`                   |
| `VITE_WEB3AUTH_CLIENT_ID` | _(your Web3Auth client ID)_                |
| `VITE_WEB3AUTH_NETWORK`   | `sapphire_mainnet`                         |

Optional overrides (all read in `src/lib/networks.ts`, each with a `_SIGNET`
twin for the runtime mainnet ⇄ signet switch): `VITE_DEFAULT_NETWORK`,
`VITE_ORD_API_URL`, `VITE_COUNTERPARTY_API_URL`, `VITE_ZELD_API_URL`,
`VITE_KONTOR_INDEXER_URL`, `VITE_KONTOR_NFT_CONTRACT`. Defaults target the
public endpoints, so a plain deploy works without any of them.

### Web3Auth domain allowlist

Web3Auth validates the request origin against the client ID's allowlist. After
the first deploy, add the Vercel domain(s) (e.g. `your-app.vercel.app` and any
preview/custom domains) to the **Whitelist** for this client ID in the Web3Auth
dashboard, or login will fail on the deployed origin.

### Deploy via CLI (optional)

```bash
cd apps/web
vercel link          # set Root Directory = apps/web when prompted
vercel               # preview deploy
vercel --prod        # production deploy
```
