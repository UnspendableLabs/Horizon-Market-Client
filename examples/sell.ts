/**
 * Sell order examples — demonstrates openSellOrder for xcp, ordinal, and zeld.
 *
 * Run with: npx tsx examples/sell.ts
 * Requires: PRIVATE_KEY env var set to a mainnet/testnet private key hex.
 */
import { HorizonMarketClient, LocalSigner } from "../src/index.js";

const PRIVATE_KEY = process.env["PRIVATE_KEY"];
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required");

// ─── XCP — existing asset UTXO ───────────────────────────────────────────────

async function sellXcpExistingUtxo() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
    baseUrl: "https://horizon.market",
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "xcp",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    assetUtxoId: "abcdef1234...64hexchars...:0", // from wallet/indexer
    priceSats: 250_000,
    satsPerVbyte: 5,
  });

  console.log("Created:", created, "Swap ID:", swap.id);
}

// ─── XCP — attach prep (no upfront asset UTXO) ───────────────────────────────

async function sellXcpAttachPrep() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  const { swap, created } = await client.openSellOrder({
    listingType: "xcp",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    priceSats: 250_000,
    // No assetUtxoId — server composes attach commit + reveal
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

  // For P2TR sellers: sellerAddress should be your bc1p… address.
  // The SDK auto-fills seller_pubkey for your Taproot address.
  const { swap } = await client.openSellOrder({
    listingType: "ordinal",
    assetUtxoId: "abcdef1234...64hexchars...:0",
    priceSats: 500_000,
    sellerAddress: "bc1p...", // your P2TR address
  });

  console.log("Ordinal listed:", swap.id);
}

// ─── ZELD — existing UTXO (mainnet only) ─────────────────────────────────────

async function sellZeld() {
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

// ─── Manual quote → sign → submit ────────────────────────────────────────────

async function sellManual() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  // 1. Request sell quote
  const quote = await client.requestSellQuote({
    price: 250_000,
    sellerAddress: "tb1q...",
    listingType: "xcp",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    assetUtxoId: "abcdef:0",
  });

  // 2. Sign swap PSBT (server-composed)
  const signer = new LocalSigner(PRIVATE_KEY, "testnet");
  const signedSwapPsbt = signer.signPsbtHex(quote.swapPsbt, quote.swapInputsToSign);
  let feePayment: { psbtHex: string; feePaymentId: string } | undefined;
  if (quote.feePsbt) {
    feePayment = {
      psbtHex: signer.signPsbtHex(quote.feePsbt, quote.feeInputsToSign),
      feePaymentId: quote.feePaymentId,
    };
  }

  // 3. Submit listing
  const { swap, created } = await client.createSwap({
    assetUtxoId: quote.assetUtxoId,
    assetUtxoValue: quote.assetUtxoValue,
    price: 250_000,
    sellerAddress: "tb1q...",
    psbtHex: signedSwapPsbt,
    listingType: "xcp",
    assetName: "RAREPEPE",
    assetQuantity: 1n,
    feePayment,
  });

  console.log("Created:", created, "Swap ID:", swap.id);
}

// Run all examples in sequence (for demonstration)
(async () => {
  console.log("=== XCP existing UTXO ===");
  await sellXcpExistingUtxo().catch(console.error);

  console.log("\n=== XCP attach prep ===");
  await sellXcpAttachPrep().catch(console.error);
})();
