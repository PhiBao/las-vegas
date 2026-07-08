import "server-only";

import { settleDueRounds } from "./jackpot-store";
import { getPublicConfig } from "./env";
import { receiveVaultDeposits, sendVaultPayout } from "./sphere-vault";

export async function runVaultAgentTick(requestUrl?: string) {
  const config = getPublicConfig(requestUrl);
  let receivedDeposits: string | undefined;

  if (config.settlementConfigured) {
    try {
      receivedDeposits = await receiveVaultDeposits(requestUrl);
    } catch (error) {
      receivedDeposits = JSON.stringify({
        warning: error instanceof Error ? error.message : "Vault receive failed."
      });
    }
  }

  return settleDueRounds(
    (recipient, amountUsdu, memo) => sendVaultPayout(recipient, amountUsdu, memo, requestUrl),
    receivedDeposits,
    requestUrl
  );
}
