/**
 * Buy order examples — demonstrates fillSwaps for counterparty, ordinal, and zeld.
 *
 * Run with: npx tsx examples/buy.ts
 * Requires: PRIVATE_KEY env var set to a mainnet/testnet private key hex.
 */
import { HorizonMarketClient, LocalSigner } from "../src/index.js";

const PRIVATE_KEY = process.env["PRIVATE_KEY"];
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required");

// ─── Buy counterparty / ZELD (multi-swap) ────────────────────────────────────

async function buyXcp() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  // Buyer address must be P2WPKH (bc1q… / tb1q…).
  // Auto-filled from signer if omitted.
  const sales = await client.fillSwaps({
    swapIds: ["swap_abc", "swap_def"],
    // buyerAddress: "tb1q...",  // optional — defaults to signer P2WPKH
    satsPerVbyte: 5,
    detach: true, // counterparty only; default true
  });

  console.log("Purchases submitted:", sales.length);
  for (const sale of sales) {
    console.log("  tx:", sale.txId, "swap:", sale.atomicSwap.id);
  }

  // Poll for confirmation
  const txIds = await client.getPendingPurchaseTxIds("swap_abc", "tb1q...");
  console.log("Pending tx ids:", txIds);
}

// ─── Buy ordinal (single swap + P2TR receive address) ────────────────────────

async function buyOrdinal() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "mainnet",
  });

  const sales = await client.fillSwaps({
    swapIds: ["swap_ordinal_xyz"], // must be exactly one for ordinals
    buyerAddress: "bc1q...",        // P2WPKH — funds the purchase
    buyerTaprootAddress: "bc1p...", // P2TR — receives the inscription
  });

  console.log("Ordinal purchase submitted:", sales[0]?.txId);
}

// ─── Manual quote → sign → submit ────────────────────────────────────────────

async function buyManual() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  const signer = new LocalSigner(PRIVATE_KEY, "testnet");
  const { p2wpkh } = signer.getAddresses();

  // 1. Request buy quote
  const quote = await client.requestBuyQuote({
    swapIds: ["swap_abc"],
    buyerAddress: p2wpkh,
    detach: true,
  });

  console.log(
    "Fee estimate:",
    quote.feeEstimateSats,
    "sats — royalty:",
    quote.royaltySats,
    "sats",
  );

  // 2. Sign buyer inputs — preserve input order (detach OP_RETURN is keyed on input 0)
  const signedPsbtHex = signer.signPsbtHex(quote.psbt, quote.inputsToSign);

  // 3. Submit purchase (NOT idempotent — do not retry on network errors)
  const sales = await client.purchaseSwaps({
    swapIds: ["swap_abc"],
    buyerAddress: p2wpkh,
    psbtHex: signedPsbtHex,
  });

  console.log("Purchase submitted:", sales[0]?.txId);
}

(async () => {
  console.log("=== Buy counterparty ===");
  await buyXcp().catch(console.error);
})();
