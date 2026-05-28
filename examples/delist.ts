/**
 * Delist example — demonstrates delistSwap and manual start → sign → confirm.
 *
 * Run with: npx tsx examples/delist.ts
 * Requires: PRIVATE_KEY env var set to a mainnet/testnet private key hex.
 */
import { HorizonMarketClient, LocalSigner } from "../src/index.js";

const PRIVATE_KEY = process.env["PRIVATE_KEY"];
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required");

// ─── Delist via workflow ──────────────────────────────────────────────────────

async function delistViaWorkflow() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  // The signer must own the seller address on the listing.
  // BIP322 signature is computed internally over the delist request id.
  await client.delistSwap("swap_abc123");

  console.log("Delisted successfully");
}

// ─── Manual start → sign → confirm ───────────────────────────────────────────

async function delistManual() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  const signer = new LocalSigner(PRIVATE_KEY, "testnet");

  // 1. Start delist — server returns a request id to sign
  const delistRequest = await client.startDelist("swap_abc123");
  console.log("Delist request id:", delistRequest.id);
  console.log("Seller address:", delistRequest.atomicSwap.sellerAddress);

  // 2. Sign the request id with BIP322 (NOT BIP137)
  const signature = signer.signMessage(
    delistRequest.atomicSwap.sellerAddress,
    delistRequest.id,
  );

  // 3. Confirm delist
  const result = await client.confirmDelist(delistRequest.id, signature);
  console.log("Confirmed delist:", result.id);
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

async function readHelpers() {
  const client = new HorizonMarketClient({
    privateKey: PRIVATE_KEY,
    network: "testnet",
  });

  // List active listings for an asset
  const { atomicSwaps, pagination } = await client.listSwaps({
    assetName: "RAREPEPE",
    funded: true,
    delisted: false,
    limit: 10,
  });
  console.log("Active listings:", atomicSwaps.length, "total:", pagination.total);

  // Check which UTXOs are already locked in active listings (avoid double-listing)
  const locked = await client.getLockedAssetUtxoIds({
    sellerAddress: "tb1q...",
  });
  console.log("Locked UTXOs:", Object.keys(locked));

  // Search asset names
  const { assetNames } = await client.searchAssetNames({ query: "RARE", limit: 5 });
  console.log("Asset names:", assetNames);
}

(async () => {
  console.log("=== Delist via workflow ===");
  await delistViaWorkflow().catch(console.error);
})();
