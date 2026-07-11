import "server-only";

import { Sphere } from "@unicitylabs/sphere-sdk";
import { createNodeProviders, createWalletApiProviders } from "@unicitylabs/sphere-sdk/impl/nodejs";

import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  SDK_NETWORK_NAME,
  toBaseUnits,
  USDU_COIN_ID,
  WALLET_API_URL
} from "@/lib/constants";
import { getServerConfig } from "./env";

type SphereInstance = Awaited<ReturnType<typeof initVaultSphere>>;

let spherePromise: Promise<SphereInstance> | null = null;

function invalidateSphere() {
  spherePromise = null;
}

export async function receiveVaultDeposits(requestUrl?: string): Promise<string | undefined> {
  const sphere = await getVaultSphere(requestUrl);
  const transfers: unknown[] = [];
  const result = await sphere.payments.receive(undefined, (transfer: unknown) => {
    transfers.push(transfer);
  });
  return JSON.stringify({ result, transfers });
}

export async function sendVaultPayout(
  recipient: string,
  amountUsdu: string,
  memo: string,
  requestUrl?: string
): Promise<string> {
  const sphere = await getVaultSphere(requestUrl);
  try {
    const result = await sphere.payments.send({
      recipient,
      amount: toBaseUnits(amountUsdu),
      coinId: USDU_COIN_ID,
      memo
    });
    return JSON.stringify(result);
  } catch (error) {
    if (error instanceof Error && /subscription|expired|unauthorized/i.test(error.message)) {
      invalidateSphere();
    }
    throw error;
  }
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

  const base = createNodeProviders({
    network: SDK_NETWORK_NAME,
    dataDir: config.walletDataDir,
    tokensDir: config.walletTokensDir,
    oracle: {
      apiKey: config.oracleApiKey,
      debug: false
    },
    transport: {
      debug: false
    }
  });
  const providers = createWalletApiProviders(base, {
    baseUrl: WALLET_API_URL,
    network: "testnet2",
    deviceId: `vault-${randomUUID()}`
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
}
