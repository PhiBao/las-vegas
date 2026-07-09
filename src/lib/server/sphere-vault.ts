import "server-only";

import { Sphere } from "@unicitylabs/sphere-sdk";
import { createNodeProviders, createWalletApiProviders } from "@unicitylabs/sphere-sdk/impl/nodejs";

import fs from "node:fs/promises";

import {
  SDK_NETWORK_NAME,
  toBaseUnits,
  USDU_COIN_ID,
  WALLET_API_URL
} from "@/lib/constants";
import { getServerConfig } from "./env";

type SphereInstance = Awaited<ReturnType<typeof initVaultSphere>>;

let spherePromise: Promise<SphereInstance> | null = null;

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

async function withTmpCwd<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!isVercel) return fn();
  const prevCwd = process.cwd();
  process.chdir("/tmp");
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
  }
}

export async function receiveVaultDeposits(requestUrl?: string): Promise<string | undefined> {
  const sphere = await getVaultSphere(requestUrl);
  return withTmpCwd(async () => {
    const transfers: unknown[] = [];
    const result = await sphere.payments.receive(undefined, (transfer) => {
      transfers.push(transfer);
    });
    return JSON.stringify({ result, transfers });
  });
}

export async function sendVaultPayout(
  recipient: string,
  amountUsdu: string,
  memo: string,
  requestUrl?: string
): Promise<string> {
  const sphere = await getVaultSphere(requestUrl);
  return withTmpCwd(async () => {
    const result = await sphere.payments.send({
      recipient,
      amount: toBaseUnits(amountUsdu),
      coinId: USDU_COIN_ID,
      memo
    });
    return JSON.stringify(result);
  });
}

async function getVaultSphere(requestUrl?: string): Promise<SphereInstance> {
  if (!spherePromise) {
    spherePromise = initVaultSphere(requestUrl);
  }
  return spherePromise;
}

async function initVaultSphere(requestUrl?: string) {
  const config = getServerConfig(requestUrl);
  if (!config.vaultMnemonic) {
    throw new Error("JACKPOT_VAULT_MNEMONIC is required for autonomous settlement.");
  }

  await fs.mkdir(config.walletDataDir, { recursive: true });
  await fs.mkdir(config.walletTokensDir, { recursive: true });

  return withTmpCwd(async () => {
    const base = createNodeProviders({
      network: SDK_NETWORK_NAME,
      dataDir: config.walletDataDir,
      tokensDir: config.walletTokensDir,
      oracle: {
        apiKey: config.oracleApiKey
      },
      transport: {
        debug: false
      }
    });
    const providers = createWalletApiProviders(base, {
      baseUrl: WALLET_API_URL,
      network: "testnet2",
      deviceId: "sphere-jackpot-vault"
    });

    const { sphere } = await Sphere.init({
      ...providers,
      mnemonic: config.vaultMnemonic,
      nametag: config.vaultNametag || undefined,
      autoGenerate: false,
      network: SDK_NETWORK_NAME,
      communications: { cacheMessages: false }
    });

    return sphere;
  });
}
