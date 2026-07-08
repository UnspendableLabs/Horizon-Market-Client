# Horizon Market CLI (`horizon`)

A scriptable command-line wallet + marketplace client built on
`@unspendablelabs/horizon-market-client`. It is the SDK's third integration
reference (alongside the web and native apps) and proves the whole flow works
**without React** — useful for bots, CI and cron.

Everything cryptographic comes from the SDK: mnemonic generation / validation /
derivation (`generateMnemonic`, `validateMnemonic`, `LocalSigner.fromMnemonic`)
and encrypted keystore blobs (`encryptKeystore` / `decryptKeystore`, scrypt +
AES-256-GCM). The CLI only does **file I/O** (`~/.horizon/keystore.json`, dir
`0700` / file `0600`) and terminal UX.

## Install

The CLI consumes the SDK's built `dist/` via `file:../../..`, so **build the SDK
first**, then build the CLI:

```bash
# 1. From the repo root — build the SDK (with the new mnemonic/keystore exports)
npm install && npm run build

# 2. In this directory
cd examples/apps/cli
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

¹ `balances --include-kontor` unlocks the keystore (Kontor reads need the signer).

Run `horizon <command> --help` for the full flag list.

### Networks

`--network mainnet|signet` (default: the keystore's network, else mainnet).
"Signet" maps to the SDK's `network:"testnet"` + `kontorNetwork:"signet"`.
Endpoints follow `examples/apps/web/src/lib/networks.ts` and are overridable via
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

- no color, spinner or prompt; workflow progress is suppressed;
- success → a single JSON object on **stdout**, exit `0` (bigints serialized as strings);
- error → `{ "error": { "message", "code"? } }` on **stderr**, exit `≠0`;
- **write** commands with a confirmation step (`sell` / `buy` / `send`) require
  `--auto-confirm` and `HORIZON_PASSWORD` (no interactive prompt is possible);
  `init` has no confirm step, so it needs only `HORIZON_PASSWORD`.

## Notes & limitations

- **Single-key model** — one derived key backs both the Segwit (p2wpkh) and
  Taproot (p2tr) address (the same model as the web/native web3auth apps). The
  Segwit address will therefore **not** match the first receive address of a
  standard BIP84 wallet.
- Address routing per asset mirrors the SDK's `depositTargetFor`:
  ordinal / Kontor-NFT / KOR → Taproot; BTC / Counterparty / ZELD → Segwit.
- **BIP39 passphrase** — not stored. If you created the wallet with
  `--passphrase`, supply it again on write commands via `--passphrase` or
  `HORIZON_PASSPHRASE` (the CLI verifies the re-derived key matches).
- **ZELD** is mainnet-only. **Kontor** writes (sell/buy/send) are wired but
  experimental on signet.
- The mnemonic is printed **only once**, at `init`.
