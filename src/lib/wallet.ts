import {
  APP_DESCRIPTION,
  APP_NAME,
  DEFAULT_TEST_USDU_MINT_AMOUNT,
  makeEntryMemo,
  SPHERE_WALLET_URL,
  toBaseUnits,
  USDU_COIN_ID
} from "./constants";
import { nowIso } from "./id";
import type { PublicRound, WalletConnection, WalletRuntime } from "./types";

type ConnectIdentity = {
  nametag?: string;
  chainPubkey?: string;
  publicKey?: string;
  directAddress?: string;
};

const SESSION_KEY = "sphere-jackpot.sphere.session";

export async function connectSphereWallet(): Promise<WalletRuntime> {
  if (typeof window === "undefined") throw new Error("Sphere can only connect in a browser.");

  const [{ SPHERE_NETWORKS, PERMISSION_SCOPES }, browser] = await Promise.all([
    import("@unicitylabs/sphere-sdk/connect"),
    import("@unicitylabs/sphere-sdk/connect/browser")
  ]);
  const { autoConnect } = browser as unknown as {
    autoConnect: (config: Record<string, unknown>) => Promise<{
      client: WalletRuntime["client"];
      connection: {
        sessionId?: string;
        identity?: ConnectIdentity;
      };
      disconnect: () => Promise<void>;
    }>;
  };

  const result = await autoConnect({
    dapp: {
      name: APP_NAME,
      description: APP_DESCRIPTION,
      url: window.location.origin
    },
    walletUrl: SPHERE_WALLET_URL,
    network: SPHERE_NETWORKS.testnet2,
    permissions: [
      PERMISSION_SCOPES.IDENTITY_READ,
      PERMISSION_SCOPES.BALANCE_READ,
      PERMISSION_SCOPES.HISTORY_READ,
      PERMISSION_SCOPES.TRANSFER_REQUEST,
      PERMISSION_SCOPES.MINT_REQUEST,
      PERMISSION_SCOPES.SIGN_REQUEST
    ],
    resumeSessionId: window.sessionStorage.getItem(SESSION_KEY) ?? undefined,
    popupFeatures: "width=440,height=720,scrollbars=yes,resizable=yes"
  });

  const identity = result.connection.identity ?? {};
  const publicKey = identity.chainPubkey ?? identity.publicKey;
  if (!publicKey && !identity.directAddress && !identity.nametag) {
    throw new Error("Sphere connected without a readable identity.");
  }

  if (result.connection.sessionId) {
    window.sessionStorage.setItem(SESSION_KEY, result.connection.sessionId);
  }

  return {
    client: result.client,
    connection: {
      mode: "sphere",
      label: identity.nametag ?? shortKey(identity.directAddress ?? publicKey ?? "Sphere wallet"),
      publicKey: publicKey ?? identity.directAddress ?? identity.nametag ?? "sphere-identity",
      directAddress: identity.directAddress,
      nametag: identity.nametag,
      connectedAt: nowIso()
    }
  };
}

export async function mintTestUsdu(runtime: WalletRuntime | null): Promise<string> {
  if (!runtime?.client?.intent) {
    throw new Error("Connect a real Sphere wallet before minting test USDU.");
  }

  const response = await runtime.client.intent("mint", {
    coinId: USDU_COIN_ID,
    amount: toBaseUnits(DEFAULT_TEST_USDU_MINT_AMOUNT)
  });
  return stringifyIntentResult(response);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s. The popup may have closed before the response reached the app. Try again.`)), ms)
    )
  ]);
}

export async function sendJackpotEntry(
  runtime: WalletRuntime | null,
  round: PublicRound,
  amountUsdu: string
): Promise<{ memo: string; txReference: string }> {
  if (!runtime?.client?.intent) {
    throw new Error("Connect a real Sphere wallet before entering the jackpot.");
  }
  const vaultRecipient = getVaultRecipient();
  if (!vaultRecipient) {
    throw new Error("Jackpot vault is not configured. Set NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT.");
  }

  const memo = makeEntryMemo(round.id, runtime.connection.nametag ?? runtime.connection.label);
  console.log("[wallet] Calling client.intent send...");
  const response = await withTimeout(
    runtime.client.intent("send", {
      to: vaultRecipient,
      amount: toBaseUnits(amountUsdu),
      coinId: USDU_COIN_ID,
      memo
    }),
    60_000,
    "Sphere send intent"
  );
  console.log("[wallet] Intent resolved:", JSON.stringify(response));
  console.log("[wallet] Intent keys:", response && typeof response === "object" ? Object.keys(response) : "N/A");

  return {
    memo,
    txReference: stringifyIntentResult(response)
  };
}

export function getVaultRecipient(): string {
  return process.env.NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT?.trim() ?? "";
}

export function getEntrantRecipient(connection: WalletConnection): string {
  return connection.directAddress ?? connection.nametag ?? connection.publicKey;
}

let _intentSeq = 0;

function stringifyIntentResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.transferId === "string") return obj.transferId;
    if (typeof obj.tokenId === "string") return obj.tokenId;
    if (typeof obj.ref === "object" && obj.ref && typeof (obj.ref as Record<string, unknown>).transferId === "string") {
      return (obj.ref as Record<string, unknown>).transferId as string;
    }
  }
  _intentSeq++;
  return `sphere-send-${Date.now()}-${_intentSeq}`;
}

function shortKey(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}
