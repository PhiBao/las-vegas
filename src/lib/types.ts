export type WalletMode = "sphere";

export type WalletConnection = {
  mode: WalletMode;
  label: string;
  publicKey: string;
  directAddress?: string;
  nametag?: string;
  connectedAt: string;
};

export type WalletRuntime = {
  connection: WalletConnection;
  client?: {
    connect: () => Promise<unknown>;
    query?: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    intent?: <T = unknown>(action: string, params: Record<string, unknown>) => Promise<T>;
    disconnect?: () => Promise<void>;
  };
};

export type RoundStatus = "open" | "locking" | "settled" | "payout_failed";

export type EntryKind = "human" | "agent";

export type PayoutStatus = "pending" | "sent" | "failed" | "not_required";

export type PublicRound = {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  startsAt: string;
  endsAt: string;
  settledAt?: string;
  vaultRecipient?: string;
  entryAmountUsdu: string;
  potAmountUsdu: string;
  coinId: string;
  seedHash: string;
  seedReveal?: string;
  winnerEntryId?: string;
  winnerLabel?: string;
  payoutAmountUsdu?: string;
  payoutTxReference?: string;
  entryCount: number;
  totalWeight: number;
};

export type JackpotEntry = {
  id: string;
  roundId: string;
  roundNumber: number;
  kind: EntryKind;
  entrantLabel: string;
  entrantPublicKey: string;
  entrantDirectAddress?: string;
  entrantNametag?: string;
  amountUsdu: string;
  weight: number;
  memo: string;
  txReference: string;
  txReferenceHash: string;
  status: "confirmed";
  createdAt: string;
};

export type JackpotAuditEvent = {
  id: string;
  roundId?: string;
  label: string;
  detail: string;
  severity: "info" | "success" | "warning" | "error";
  txReference?: string;
  createdAt: string;
};

export type JackpotPayout = {
  id: string;
  roundId: string;
  recipient: string;
  amountUsdu: string;
  status: PayoutStatus;
  txReference?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type JackpotConfigStatus = {
  appUrl: string;
  network: "testnet2";
  tokenSymbol: "USDU";
  coinId: string;
  decimals: number;
  entryAmountUsdu: string;
  entryAmountBaseUnits: string;
  roundDurationMinutes: number;
  vaultRecipient: string;
  vaultConfigured: boolean;
  settlementConfigured: boolean;
  persistence: "postgres" | "local-file";
};

export type PublicJackpotState = {
  serverTime: string;
  currentRound: PublicRound;
  recentEntries: JackpotEntry[];
  recentRounds: PublicRound[];
  payouts: JackpotPayout[];
  audit: JackpotAuditEvent[];
  config: JackpotConfigStatus;
};

export type AgentEntryCard = {
  version: "sphere-jackpot-v1";
  network: "testnet2";
  roundId: string;
  roundNumber: number;
  roundEndsAt: string;
  vaultRecipient: string;
  coin: {
    symbol: "USDU";
    coinId: string;
    decimals: number;
  };
  amountUsdu: string;
  amountBaseUnits: string;
  memo: string;
  entryCallbackUrl: string;
  tickUrl: string;
  instructions: string[];
};

export type CreateEntryInput = {
  roundId: string;
  kind: EntryKind;
  entrant: WalletConnection;
  amountUsdu: string;
  memo: string;
  txReference: string;
};

export type TickResult = {
  processedAt: string;
  settledRoundIds: string[];
  openedRoundId: string;
  receivedDeposits?: string;
  warnings: string[];
};
