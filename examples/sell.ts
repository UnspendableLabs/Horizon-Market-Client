/**
 * Sell order examples — demonstrates openSellOrder for counterparty, ordinal, and zeld.
 *
 * Run with: npx tsx examples/sell.ts
 * Requires: PRIVATE_KEY env var set to a mainnet/testnet private key hex.
 */
import * as btc from "bitcoinjs-lib";
import {
  HorizonMarketClient,
  LocalSigner,
  signAndFinalizeSellPrep,
} from "../src/index.js";

const PRIVATE_KEY = process.env["PRIVATE_KEY"];
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required");

// ─── Counterparty — existing asset UTXO ──────────────────────────────────────

async function sellCounterpartyExistingUtxo() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
    baseUrl: "https://horizon.market",
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "counterparty",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    assetUtxoId: "abcdef1234...64hexchars...:0", // from wallet/indexer
    priceSats: 250_000,
    satsPerVbyte: 5,
  });

  console.log("Created:", created, "Swap ID:", swap.id);
}

// ─── Counterparty — attach prep (no upfront asset UTXO) ──────────────────────

async function sellCounterpartyAttachPrep() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "counterparty",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    priceSats: 250_000,
    // No assetUtxoId — server composes attach commit + reveal (or reuses existing UTXO)
  });

  console.log("Created:", created, "Swap ID:", swap.id, "Funded:", swap.funded);
  // Listing may be funded: false until prep tx confirms on-chain.
}

// ─── Ordinal — existing inscription UTXO ─────────────────────────────────────

async function sellOrdinal() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "mainnet",
  });

  // Omit sellerAddress to auto-fill from the signer's P2TR address (recommended).
  // If you pass an external P2TR sellerAddress, also pass sellerPubkey (32-byte x-only hex).
  const { swap } = await client.openSellOrder({
    listingType: "ordinal",
    assetUtxoId: "abcdef1234...64hexchars...:0",
    priceSats: 500_000,
    // sellerAddress auto-filled from signer P2TR; or pass sellerAddress + sellerPubkey explicitly.
  });

  console.log("Ordinal listed:", swap.id);
}

// ─── ZELD — existing UTXO (mainnet only) ─────────────────────────────────────

async function sellZeldExistingUtxo() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "mainnet", // ZELD is mainnet only
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "zeld",
    assetName: "ZELD",
    assetQuantity: 100_000_000n,
    assetUtxoId: "fedcba...64hexchars...:0",
    priceSats: 250_000,
  });

  // created: false on ZELD idempotent replay (HTTP 200 with existing listing).
  // created: true on new listing (HTTP 201).
  // Throws HorizonMarketApiError(409) if a conflicting ZELD listing exists.
  console.log("Created:", created, "Swap ID:", swap.id);
}

// ─── ZELD — transfer prep (no upfront UTXO, mainnet only) ────────────────────

async function sellZeldTransferPrep() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "mainnet",
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "zeld",
    assetName: "ZELD",
    assetQuantity: 100_000_000n,
    priceSats: 250_000,
    // No assetUtxoId — server composes prep tx (isolates ZELD + platform fee)
  });

  console.log("Created:", created, "Swap ID:", swap.id, "Funded:", swap.funded);
  // Listing may be funded: false until prep tx confirms on-chain.
}

// ─── Manual quote → sign → submit ────────────────────────────────────────────

async function sellManual() {
  const network: "mainnet" | "testnet" = "testnet";
  const btcNetwork =
    network === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network,
  });
  const signer = new LocalSigner(PRIVATE_KEY!, network);
  const sellerAddress = signer.getAddresses().p2wpkh;

  // 1. Request sell quote
  const quote = await client.requestSellQuote({
    price: 250_000,
    sellerAddress,
    listingType: "counterparty",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    assetUtxoId: "abcdef:0",
  });

  // 2. Sign + finalize prep PSBT when present (attach or zeld transfer)
  const prep = signAndFinalizeSellPrep(quote, signer, btcNetwork);

  // 3. Sign swap PSBT (do NOT finalize)
  const signedSwapPsbt = signer.signPsbtHex(
    quote.swapPsbt,
    quote.swapInputsToSign,
  );

  // 4. Sign fee PSBT if present (do NOT finalize)
  let feePayment: { psbtHex: string; feePaymentId: string } | undefined;
  if (quote.feePsbt && quote.feePaymentId) {
    feePayment = {
      psbtHex: signer.signPsbtHex(quote.feePsbt, quote.feeInputsToSign),
      feePaymentId: quote.feePaymentId,
    };
  }

  // 5. Submit listing — always use quote-derived asset UTXO fields
  const { swap, created } = await client.createSwap({
    assetUtxoId: quote.assetUtxoId,
    assetUtxoValue: quote.assetUtxoValue,
    price: 250_000,
    sellerAddress,
    psbtHex: signedSwapPsbt,
    listingType: "counterparty",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    feePayment,
    zeldPayment: prep?.zeldPayment,
    fundingTxHex: prep?.fundingTxHex,
    revealTxHex: prep?.revealTxHex,
  });

  console.log("Created:", created, "Swap ID:", swap.id);
}

// Run examples: `npx tsx examples/sell.ts [counterparty-existing|counterparty-attach|ordinal|zeld-utxo|zeld-prep|manual|all]`
const SCENARIO = process.argv[2] ?? "counterparty-existing";

const SCENARIOS: Record<string, () => Promise<void>> = {
  "counterparty-existing": sellCounterpartyExistingUtxo,
  "counterparty-attach": sellCounterpartyAttachPrep,
  ordinal: sellOrdinal,
  "zeld-utxo": sellZeldExistingUtxo,
  "zeld-prep": sellZeldTransferPrep,
  manual: sellManual,
};

async function runScenario(name: string, fn: () => Promise<void>) {
  console.log(`=== ${name} ===`);
  await fn().catch(console.error);
}

(async () => {
  if (SCENARIO === "all") {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      await runScenario(name, fn);
    }
    return;
  }

  const fn = SCENARIOS[SCENARIO];
  if (!fn) {
    console.error(
      `Unknown scenario "${SCENARIO}". Use one of: ${Object.keys(SCENARIOS).join(", ")}, all`,
    );
    process.exit(1);
  }
  await runScenario(SCENARIO, fn);
})();
