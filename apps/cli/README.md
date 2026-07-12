# Horizon Market CLI (`horizon`)

A scriptable command-line wallet + marketplace client built on
`@unspendablelabs/horizon-market-client`. It is the SDK's third integration
reference (alongside the web and native apps) and proves the whole flow works
**without React** — useful for bots, CI and cron.

Everything cryptographic comes from the SDK: mnemonic generation / validation /
Horizon-Wallet-compatible derivation (`generateMnemonic`, `validateMnemonic`,
`HDSigner.fromMnemonic` — BIP84 segwit + BIP86 taproot) and encrypted keystore
blobs (`encryptKeystore` / `decryptKeystore`, scrypt + AES-256-GCM). The CLI only
does **file I/O** (`~/.horizon/keystore.json`, dir `0700` / file `0600`) and
terminal UX.

## Install

The CLI ships as the npm package's `bin` — a global install is all you need:

```bash
npm install -g @unspendablelabs/horizon-market-client
horizon --help
```

### From source (this repo)

The CLI consumes the SDK's built `dist/` via `file:../..`, so **build the SDK
first**, then build the CLI:

```bash
# 1. From the repo root — build the SDK
npm install && npm run build

# 2. In this directory
cd apps/cli
npm install
npm run build
npm link            # optional: exposes `horizon` on your PATH
```

Fast dev loop (no build): `npm run horizon -- <command> [flags]` (runs via `tsx`).

## Commands

| Command    | Auth        | What it does |
|------------|-------------|--------------|
| `init`     | password    | Create or import an encrypted wallet keystore |
| `list`     | none        | List open swap listings |
| `balances` | none¹       | Show BTC / Counterparty / ZELD / ordinal balances |
| `sell`     | password    | Open a sell order |
| `buy`      | password    | Fill (purchase) a swap |
| `send`     | password    | Send / withdraw any asset type |

¹ `balances --include-kontor` unlocks the keystore (Kontor reads need the
signer) — on signet only; on mainnet it prints a note and skips the Kontor read.

Run `horizon <command> --help` for the full flag list.

### Importing a wallet

`horizon init --import` reads an existing mnemonic via a **hidden prompt** (TTY)
or **stdin** (piped) so the phrase never lands in your shell history. A positional
mnemonic argument still works but is discouraged for that reason.

### Networks

`--network mainnet|signet` (default: the keystore's network, else mainnet —
`init` itself always defaults to mainnet since no keystore exists yet).
"Signet" maps to the SDK's `network:"testnet"` + `kontorNetwork:"signet"`.
Endpoints follow `apps/web/src/lib/networks.ts` and are overridable via
`HORIZON_*` env vars (see `.env.example`).

## Examples

```bash
# Create a throwaway signet wallet (JSON mode for scripting)
export HORIZON_HOME=$(mktemp -d)
HORIZON_PASSWORD=test horizon init --network signet --json

# Browse listings (read-only, no password); bigints are strings in --json
horizon list --network signet --type counterparty
horizon list --network signet --json | jq '.swaps[0]'

# Balances
horizon balances --network signet

# Sell (interactive review + confirm)
horizon sell --network signet --type counterparty --asset RAREPEPE --amount 1 --price 10000

# Scripted write: --json requires --auto-confirm + HORIZON_PASSWORD
HORIZON_PASSWORD=test horizon sell --network signet \
  --type counterparty --asset RAREPEPE --amount 1 --price 10000 \
  --auto-confirm --json
```

## `--json` mode

Enabled by `--json` **or** whenever stdout is not a TTY (pipes, CI). In this mode:

- no color or prompt; workflow progress is suppressed;
- success → a single JSON object on **stdout**, exit `0` (bigints serialized as strings);
- error → `{ "error": { "message", "code"? } }` on **stderr**, exit `≠0`;
- **write** commands with a confirmation step (`sell` / `buy` / `send`) require
  `--auto-confirm` and `HORIZON_PASSWORD` (no interactive prompt is possible);
  `init` has no confirm step, so it needs only `HORIZON_PASSWORD`.

## Notes & limitations

- **Horizon Wallet derivation** — the CLI derives addresses exactly like the
  Horizon Wallet browser extension: a **BIP84** key (`m/84'/<coin>'/<account>'/0/0`)
  backs the Segwit (p2wpkh) address and a **BIP86** key
  (`m/86'/<coin>'/<account>'/0/0`) backs the Taproot (p2tr) address, with
  `coin_type` per network (`0'` mainnet, `1'` signet/testnet). Import the same
  mnemonic here and in Horizon Wallet and you get the **same** Segwit *and*
  Taproot addresses. Pick the account with `init --account N` (default 0; the
  other commands read it from the keystore). Note: `init` generates a 24-word
  phrase by default — pass `--words 12` if the wallet must also be importable
  into 12-word-only wallets (Horizon Wallet, XVerse).
- Address routing per asset mirrors the SDK's `depositTargetFor`:
  ordinal / Kontor-NFT / KOR → Taproot; BTC / Counterparty / ZELD → Segwit.
  Kontor/KOR sign with the BIP86 (Taproot) key.
- **BIP39 passphrase** — not stored. If you created the wallet with
  `--passphrase`, supply it again on every command that unlocks the keystore
  (writes, and `balances --include-kontor`) via `--passphrase` or
  `HORIZON_PASSPHRASE` (the CLI verifies the re-derived addresses match).
- **ZELD** is mainnet-only by default (a signet endpoint can be supplied via
  `HORIZON_ZELD_API_URL_SIGNET`). **Kontor** writes (sell/buy/send) are wired
  but experimental on signet.
- The mnemonic is printed **only once**, at `init`.
