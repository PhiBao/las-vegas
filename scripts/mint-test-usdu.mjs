/**
 * Mints test USDU to the vault wallet for funding payouts.
 *
 * Usage:
 *   node scripts/mint-test-usdu.mjs [amount]
 *
 * Requires:
 *   JACKPOT_VAULT_MNEMONIC in env or .env
 *
 * Default mint: 100 USDU
 */

import { Sphere } from "@unicitylabs/sphere-sdk";
import { createNodeProviders, createWalletApiProviders } from "@unicitylabs/sphere-sdk/impl/nodejs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const USDU_COIN_ID = "e210f98956f564bfe67ee94fddd386b5157f660d1957169b391f962093a2da2a";
const USDU_DECIMALS = 6;

async function loadEnv() {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const content = await fs.readFile(envPath, "utf8");
    const vars = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

async function main() {
  await loadEnv();

  const mnemonic = process.env.JACKPOT_VAULT_MNEMONIC;
  if (!mnemonic) {
    console.error("JACKPOT_VAULT_MNEMONIC is required. Set it in .env or environment.");
    process.exitCode = 1;
    return;
  }

  const amount = process.argv[2] || "100";
  const baseUnits = (BigInt(Math.floor(Number(amount) * 10 ** USDU_DECIMALS))).toString();

  console.log(`Minting ${amount} USDU (${baseUnits} base units) to vault wallet...\n`);

  const dataDir = process.env.JACKPOT_WALLET_DATA_DIR || path.join(process.cwd(), ".data", "jackpot-vault", "wallet");
  const tokensDir = process.env.JACKPOT_WALLET_TOKENS_DIR || path.join(process.cwd(), ".data", "jackpot-vault", "tokens");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(tokensDir, { recursive: true });

  const base = createNodeProviders({
    network: "testnet2",
    dataDir,
    tokensDir,
    oracle: {
      apiKey: process.env.SPHERE_ORACLE_API_KEY || "sk_ddc3cfcc001e4a28ac3fad7407f99590"
    },
    transport: { debug: false }
  });

  const providers = createWalletApiProviders(base, {
    baseUrl: "https://wallet-api.unicity.network",
    network: "testnet2",
    deviceId: "sphere-jackpot-vault"
  });

  const { sphere } = await Sphere.init({
    ...providers,
    mnemonic,
    autoGenerate: false,
    network: "testnet2",
    communications: { cacheMessages: false }
  });

  console.log(`Vault identity: @${sphere.identity?.nametag ?? "unknown"}`);

  let result;
  if (typeof sphere.payments.mintFungibleToken === "function") {
    result = await sphere.payments.mintFungibleToken(USDU_COIN_ID, BigInt(baseUnits));
  } else if (typeof sphere.payments.mintFungibleTokenV2 === "function") {
    result = await sphere.payments.mintFungibleTokenV2(USDU_COIN_ID, BigInt(baseUnits));
  } else {
    throw new Error("No mint method found. Available: " + Object.getOwnPropertyNames(Object.getPrototypeOf(sphere.payments)).filter(m => m.includes("mint")).join(", "));
  }

  console.log(`\nMint result:`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nBalance should now include ${amount} USDU.`);
}

main().catch((error) => {
  console.error("Mint failed:", error);
  process.exitCode = 1;
});
