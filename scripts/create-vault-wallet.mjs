/**
 * Creates a fresh testnet2 Sphere wallet for the jackpot vault.
 *
 * Usage:
 *   node scripts/create-vault-wallet.mjs
 *
 * This script:
 * 1. Generates a new HD wallet with a dedicated mnemonic
 * 2. Registers a nametag (@sphere-jackpot-vault or custom)
 * 3. Outputs the mnemonic, nametag, and recipient address
 *
 * IMPORTANT: Copy the mnemonic immediately — it is NOT stored anywhere.
 */

import { Sphere } from "@unicitylabs/sphere-sdk";
import { createNodeProviders, createWalletApiProviders } from "@unicitylabs/sphere-sdk/impl/nodejs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data", "vault-wallet");
const TOKENS_DIR = path.join(DATA_DIR, "tokens");
const WALLET_DIR = path.join(DATA_DIR, "wallet");

const nametag = process.argv[2] || "sphere-jackpot-vault";

async function main() {
  console.log(`Creating vault wallet with nametag: @${nametag}\n`);

  await fs.mkdir(WALLET_DIR, { recursive: true });
  await fs.mkdir(TOKENS_DIR, { recursive: true });

  const base = createNodeProviders({
    network: "testnet2",
    dataDir: WALLET_DIR,
    tokensDir: TOKENS_DIR,
    oracle: {
      apiKey: process.env.SPHERE_ORACLE_API_KEY || "sk_ddc3cfcc001e4a28ac3fad7407f99590"
    },
    transport: { debug: false }
  });

  const providers = createWalletApiProviders(base, {
    baseUrl: "https://wallet-api.unicity.network",
    network: "testnet2",
    deviceId: `vault-${Date.now()}`
  });

  const { sphere, created, generatedMnemonic } = await Sphere.init({
    ...providers,
    autoGenerate: true,
    nametag,
    network: "testnet2",
    communications: { cacheMessages: false }
  });

  console.log("=".repeat(60));
  console.log("VAULT WALLET CREATED");
  console.log("=".repeat(60));
  console.log();
  console.log(`Nametag:      @${sphere.identity?.nametag ?? nametag}`);
  console.log(`Created new:  ${created}`);
  console.log();
  console.log("Mnemonic (SAVE THIS — not stored anywhere):");
  console.log(generatedMnemonic);
  console.log();
  console.log("=".repeat(60));
  console.log("NEXT STEPS:");
  console.log("=".repeat(60));
  console.log();
  console.log("1. Copy the mnemonic above");
  console.log("2. Add to your .env or Vercel env vars:");
  console.log(`   JACKPOT_VAULT_MNEMONIC="${generatedMnemonic}"`);
  console.log(`   NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT="@${nametag}"`);
  console.log(`   JACKPOT_VAULT_NAMETAG="${nametag}"`);
  console.log();
  console.log("3. Mint test USDU to fund initial payouts:");
  console.log("   node scripts/mint-test-usdu.mjs");
  console.log();

  // Mint initial test USDU to fund payouts
  try {
    console.log("Minting 100 test USDU to vault wallet...");
    let mintResult;
    if (typeof sphere.payments.mintFungibleToken === "function") {
      mintResult = await sphere.payments.mintFungibleToken("e210f98956f564bfe67ee94fddd386b5157f660d1957169b391f962093a2da2a", BigInt("100000000"));
    } else if (typeof sphere.payments.mintFungibleTokenV2 === "function") {
      mintResult = await sphere.payments.mintFungibleTokenV2("e210f98956f564bfe67ee94fddd386b5157f660d1957169b391f962093a2da2a", BigInt("100000000"));
    } else {
      console.log("Auto-mint not available on this SDK version. Run: pnpm mint:test-usdu");
      return;
    }
    console.log(`Mint result: ${JSON.stringify(mintResult, null, 2)}`);
  } catch (error) {
    console.log(`Auto-mint failed (run 'pnpm mint:test-usdu' manually): ${error.message}`);
  }
}

main().catch((error) => {
  console.error("Failed to create vault wallet:", error);
  process.exitCode = 1;
});
