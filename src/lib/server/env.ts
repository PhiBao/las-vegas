import "server-only";

import path from "node:path";

import {
  DEFAULT_ENTRY_AMOUNT_USDU,
  DEFAULT_ORACLE_API_KEY,
  DEFAULT_ROUND_DURATION_MINUTES,
  LOCAL_STORAGE_WARNING,
  SPHERE_NETWORK_NAME,
  toBaseUnits,
  USDU_COIN_ID,
  USDU_DECIMALS,
  USDU_SYMBOL
} from "@/lib/constants";
import type { JackpotConfigStatus } from "@/lib/types";

export type ServerConfig = {
  appUrl: string;
  cronSecret: string;
  databaseUrl: string;
  entryAmountUsdu: string;
  entryAmountBaseUnits: string;
  oracleApiKey: string;
  roundDurationMinutes: number;
  storageFile: string;
  vaultMnemonic: string;
  vaultNametag: string;
  vaultRecipient: string;
  walletDataDir: string;
  walletTokensDir: string;
};

export function getServerConfig(requestUrl?: string): ServerConfig {
  const appUrl = resolveAppUrl(requestUrl);
  const entryAmountUsdu = process.env.JACKPOT_ENTRY_AMOUNT_USDU?.trim() || DEFAULT_ENTRY_AMOUNT_USDU;
  const roundDurationMinutes = parsePositiveInteger(
    process.env.ROUND_DURATION_MINUTES,
    DEFAULT_ROUND_DURATION_MINUTES
  );

  return {
    appUrl,
    cronSecret: process.env.CRON_SECRET?.trim() ?? "",
    databaseUrl: process.env.DATABASE_URL?.trim() ?? "",
    entryAmountUsdu,
    entryAmountBaseUnits: toBaseUnits(entryAmountUsdu),
    oracleApiKey: process.env.SPHERE_ORACLE_API_KEY?.trim() || DEFAULT_ORACLE_API_KEY,
    roundDurationMinutes,
    storageFile:
      process.env.JACKPOT_STORAGE_FILE?.trim() ||
      path.join(process.cwd(), ".data", "jackpot-store.json"),
    vaultMnemonic: process.env.JACKPOT_VAULT_MNEMONIC?.trim() ?? "",
    vaultNametag: process.env.JACKPOT_VAULT_NAMETAG?.replace(/^@/, "").trim() ?? "",
    vaultRecipient:
      process.env.NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT?.trim() ||
      process.env.JACKPOT_VAULT_RECIPIENT?.trim() ||
      "",
    walletDataDir:
      process.env.JACKPOT_WALLET_DATA_DIR?.trim() ||
      path.join(process.cwd(), ".data", "jackpot-vault", "wallet"),
    walletTokensDir:
      process.env.JACKPOT_WALLET_TOKENS_DIR?.trim() ||
      path.join(process.cwd(), ".data", "jackpot-vault", "tokens")
  };
}

export function getPublicConfig(requestUrl?: string): JackpotConfigStatus {
  const config = getServerConfig(requestUrl);
  return {
    appUrl: config.appUrl,
    network: SPHERE_NETWORK_NAME,
    tokenSymbol: USDU_SYMBOL,
    coinId: USDU_COIN_ID,
    decimals: USDU_DECIMALS,
    entryAmountUsdu: config.entryAmountUsdu,
    entryAmountBaseUnits: config.entryAmountBaseUnits,
    roundDurationMinutes: config.roundDurationMinutes,
    vaultRecipient: config.vaultRecipient,
    vaultConfigured: Boolean(config.vaultRecipient),
    settlementConfigured: Boolean(config.vaultMnemonic && config.vaultRecipient),
    persistence: config.databaseUrl ? "postgres" : "local-file"
  };
}

export function getSetupWarnings(requestUrl?: string): string[] {
  const publicConfig = getPublicConfig(requestUrl);
  const warnings: string[] = [];
  if (!publicConfig.vaultConfigured) {
    warnings.push("Set NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT before accepting real entries.");
  }
  if (!publicConfig.settlementConfigured) {
    warnings.push("Set JACKPOT_VAULT_MNEMONIC before autonomous payouts can run.");
  }
  if (publicConfig.persistence === "local-file") {
    warnings.push(LOCAL_STORAGE_WARNING);
  }
  return warnings;
}

function resolveAppUrl(requestUrl?: string): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
