import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import { addDecimalStrings, makeEntryMemo, normalizeAmount, USDU_COIN_ID } from "@/lib/constants";
import type {
  AgentEntryCard,
  CreateEntryInput,
  JackpotAuditEvent,
  JackpotEntry,
  JackpotPayout,
  PublicJackpotState,
  PublicRound,
  RoundStatus,
  TickResult
} from "@/lib/types";
import { getPublicConfig, getServerConfig, getSetupWarnings, type ServerConfig } from "./env";

type InternalRound = Omit<PublicRound, "entryCount" | "totalWeight"> & {
  seedSecret: string;
  createdAt: string;
  updatedAt: string;
};

type StoreData = {
  rounds: InternalRound[];
  entries: JackpotEntry[];
  payouts: JackpotPayout[];
  audit: JackpotAuditEvent[];
};

type RoundRow = {
  id: string;
  round_number: number;
  status: RoundStatus;
  starts_at: Date | string;
  ends_at: Date | string;
  settled_at: Date | string | null;
  vault_recipient: string | null;
  entry_amount_usdu: string;
  pot_amount_usdu: string;
  coin_id: string;
  seed_hash: string;
  seed_secret: string;
  seed_reveal: string | null;
  winner_entry_id: string | null;
  winner_label: string | null;
  payout_amount_usdu: string | null;
  payout_tx_reference: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type EntryRow = {
  id: string;
  round_id: string;
  round_number: number;
  entry_kind: "human" | "agent";
  entrant_label: string;
  entrant_public_key: string;
  entrant_direct_address: string | null;
  entrant_nametag: string | null;
  amount_usdu: string;
  weight: number;
  memo: string;
  tx_reference: string;
  tx_reference_hash: string;
  status: "confirmed";
  created_at: Date | string;
};

type AuditRow = {
  id: string;
  round_id: string | null;
  label: string;
  detail: string;
  severity: "info" | "success" | "warning" | "error";
  tx_reference: string | null;
  created_at: Date | string;
};

type PayoutRow = {
  id: string;
  round_id: string;
  recipient: string;
  amount_usdu: string;
  status: "pending" | "sent" | "failed" | "not_required";
  tx_reference: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PayoutSender = (recipient: string, amountUsdu: string, memo: string) => Promise<string>;

let sqlClient: ReturnType<typeof postgres> | null = null;
let sqlReady = false;

export async function getJackpotState(requestUrl?: string): Promise<PublicJackpotState> {
  const config = getServerConfig(requestUrl);
  await ensureOpenRound(config);

  if (config.databaseUrl) {
    const sql = await getSql(config);
    const [openRound] = await sql<RoundRow[]>`
      SELECT * FROM jackpot_rounds WHERE status = 'open' ORDER BY round_number DESC LIMIT 1
    `;
    const recentRounds = await sql<RoundRow[]>`
      SELECT * FROM jackpot_rounds
      WHERE status <> 'open'
      ORDER BY round_number DESC
      LIMIT 5
    `;
    const recentEntries = await sql<EntryRow[]>`
      SELECT * FROM jackpot_entries ORDER BY created_at DESC LIMIT 10
    `;
    const payouts = await sql<PayoutRow[]>`
      SELECT * FROM jackpot_payouts ORDER BY created_at DESC LIMIT 5
    `;
    const audit = await sql<AuditRow[]>`
      SELECT * FROM jackpot_audit_events ORDER BY created_at DESC LIMIT 10
    `;

    return {
      serverTime: new Date().toISOString(),
      currentRound: await toPublicRound(openRound, await getEntriesForRound(openRound.id, config)),
      recentEntries: recentEntries.map(entryFromRow),
      recentRounds: await Promise.all(
        recentRounds.map(async (round) => toPublicRound(round, await getEntriesForRound(round.id, config)))
      ),
      payouts: payouts.map(payoutFromRow),
      audit: audit.map(auditFromRow),
      config: getPublicConfig(requestUrl)
    };
  }

  const data = await readFileData(config);
  const openRound = data.rounds.find((round) => round.status === "open") ?? data.rounds.at(-1);
  if (!openRound) throw new Error("Jackpot store failed to create an open round.");
  return {
    serverTime: new Date().toISOString(),
    currentRound: toPublicRoundFromInternal(
      openRound,
      data.entries.filter((entry) => entry.roundId === openRound.id)
    ),
    recentEntries: data.entries.slice().sort(descByCreatedAt).slice(0, 18),
    recentRounds: data.rounds
      .filter((round) => round.status !== "open")
      .sort((a, b) => b.roundNumber - a.roundNumber)
      .slice(0, 8)
      .map((round) => toPublicRoundFromInternal(round, data.entries.filter((entry) => entry.roundId === round.id))),
    payouts: data.payouts.slice().sort(descByCreatedAt).slice(0, 8),
    audit: data.audit.slice().sort(descByCreatedAt).slice(0, 24),
    config: getPublicConfig(requestUrl)
  };
}

export async function createJackpotEntry(
  input: CreateEntryInput,
  requestUrl?: string
): Promise<{ entry: JackpotEntry; state: PublicJackpotState }> {
  const config = getServerConfig(requestUrl);
  const publicConfig = getPublicConfig(requestUrl);
  if (!publicConfig.vaultConfigured) {
    throw new Error("Jackpot vault is not configured.");
  }

  const amountUsdu = normalizeAmount(input.amountUsdu);
  if (amountUsdu !== normalizeAmount(config.entryAmountUsdu)) {
    throw new Error(`Entry amount must be exactly ${config.entryAmountUsdu} USDU.`);
  }
  if (!input.txReference || input.txReference.length > 12000) {
    throw new Error("A Sphere transaction reference is required.");
  }
  if (!input.memo.startsWith(`JACKPOT:${input.roundId}:`)) {
    throw new Error("Entry memo must be bound to the active round.");
  }
  if (input.entrant.mode !== "sphere") {
    throw new Error("Only real Sphere wallets can enter the jackpot.");
  }

  await ensureOpenRound(config);
  const txReferenceHash = sha256(input.txReference);
  const now = new Date().toISOString();

  if (config.databaseUrl) {
    const sql = await getSql(config);
    const [round] = await sql<RoundRow[]>`
      SELECT * FROM jackpot_rounds WHERE id = ${input.roundId} LIMIT 1
    `;
    assertRoundAcceptsEntries(round);

    const [existing] = await sql<EntryRow[]>`
      SELECT * FROM jackpot_entries WHERE tx_reference_hash = ${txReferenceHash} LIMIT 1
    `;
    if (existing) {
      return {
        entry: entryFromRow(existing),
        state: await getJackpotState(requestUrl)
      };
    }

    const entryId = `entry_${crypto.randomUUID()}`;
    const inserted = await sql<EntryRow[]>`
      INSERT INTO jackpot_entries (
        id, round_id, round_number, entry_kind, entrant_label, entrant_public_key,
        entrant_direct_address, entrant_nametag, amount_usdu, weight, memo,
        tx_reference, tx_reference_hash, status, created_at
      )
      VALUES (
        ${entryId}, ${round.id}, ${round.round_number}, ${input.kind}, ${input.entrant.label},
        ${input.entrant.publicKey}, ${input.entrant.directAddress ?? null}, ${input.entrant.nametag ?? null},
        ${amountUsdu}, 1, ${input.memo}, ${input.txReference}, ${txReferenceHash}, 'confirmed', ${now}
      )
      RETURNING *
    `;
    await sql`
      UPDATE jackpot_rounds
      SET pot_amount_usdu = pot_amount_usdu + ${amountUsdu}::numeric, updated_at = NOW()
      WHERE id = ${round.id}
    `;
    await insertAudit(config, {
      roundId: round.id,
      label: input.kind === "agent" ? "Agent entry confirmed" : "Entry confirmed",
      detail: `${input.entrant.label} entered round #${round.round_number} with ${amountUsdu} USDU.`,
      severity: "success",
      txReference: input.txReference
    });

    return {
      entry: entryFromRow(inserted[0]),
      state: await getJackpotState(requestUrl)
    };
  }

  const data = await readFileData(config);
  const round = data.rounds.find((candidate) => candidate.id === input.roundId);
  assertRoundAcceptsEntries(round);
  const existing = data.entries.find((entry) => entry.txReferenceHash === txReferenceHash);
  if (existing) {
    return { entry: existing, state: await getJackpotState(requestUrl) };
  }

  const entry: JackpotEntry = {
    id: `entry_${crypto.randomUUID()}`,
    roundId: round.id,
    roundNumber: round.roundNumber,
    kind: input.kind,
    entrantLabel: input.entrant.label,
    entrantPublicKey: input.entrant.publicKey,
    entrantDirectAddress: input.entrant.directAddress,
    entrantNametag: input.entrant.nametag,
    amountUsdu,
    weight: 1,
    memo: input.memo,
    txReference: input.txReference,
    txReferenceHash,
    status: "confirmed",
    createdAt: now
  };
  data.entries.push(entry);
  round.potAmountUsdu = addDecimalStrings(round.potAmountUsdu, amountUsdu);
  round.updatedAt = now;
  data.audit.push(makeAuditEvent({
    roundId: round.id,
    label: input.kind === "agent" ? "Agent entry confirmed" : "Entry confirmed",
    detail: `${input.entrant.label} entered round #${round.roundNumber} with ${amountUsdu} USDU.`,
    severity: "success",
    txReference: input.txReference
  }));
  await writeFileData(config, data);

  return { entry, state: await getJackpotState(requestUrl) };
}

export async function getAgentEntryCard(requestUrl?: string): Promise<AgentEntryCard> {
  const config = getServerConfig(requestUrl);
  const state = await getJackpotState(requestUrl);
  const memo = makeEntryMemo(state.currentRound.id, "agent");
  return {
    version: "sphere-jackpot-v1",
    network: "testnet2",
    roundId: state.currentRound.id,
    roundNumber: state.currentRound.roundNumber,
    roundEndsAt: state.currentRound.endsAt,
    vaultRecipient: config.vaultRecipient,
    coin: {
      symbol: "USDU",
      coinId: USDU_COIN_ID,
      decimals: 6
    },
    amountUsdu: config.entryAmountUsdu,
    amountBaseUnits: config.entryAmountBaseUnits,
    memo,
    entryCallbackUrl: `${config.appUrl}/api/entries`,
    tickUrl: `${config.appUrl}/api/agent/tick`,
    instructions: [
      "Send the amount to vaultRecipient on Sphere testnet2 using the memo exactly as provided.",
      "POST the Sphere send result to entryCallbackUrl with kind=agent and the same roundId, amountUsdu, memo, txReference, and entrant identity.",
      "The autonomous vault agent settles expired rounds through tickUrl; external agents do not need settlement permissions."
    ]
  };
}

export async function settleDueRounds(
  sendPayout: PayoutSender,
  receivedDeposits: string | undefined,
  requestUrl?: string
): Promise<TickResult> {
  const config = getServerConfig(requestUrl);
  await ensureOpenRound(config);
  const settledRoundIds: string[] = [];
  const warnings = getSetupWarnings(requestUrl);

  if (config.databaseUrl) {
    const sql = await getSql(config);

    // Retry rounds with failed payouts (e.g. session expiry recovered next tick)
    const retryRounds = await sql<RoundRow[]>`
      SELECT r.* FROM jackpot_rounds r
      INNER JOIN jackpot_payouts p ON p.round_id = r.id AND p.status = 'failed'
      WHERE r.status = 'payout_failed' AND r.pot_amount_usdu > '0'::numeric
      ORDER BY r.round_number ASC
    `;
    for (const retryRound of retryRounds) {
      await sql`UPDATE jackpot_rounds SET status = 'locking', updated_at = NOW() WHERE id = ${retryRound.id}`;
      await settleOneSqlRound(retryRound, sendPayout, config);
      settledRoundIds.push(retryRound.id);
    }

    const dueRounds = await sql<RoundRow[]>`
      UPDATE jackpot_rounds
      SET status = 'locking', updated_at = NOW()
      WHERE status = 'open' AND ends_at <= NOW()
      RETURNING *
    `;
    for (const dueRound of dueRounds) {
      await settleOneSqlRound(dueRound, sendPayout, config);
      settledRoundIds.push(dueRound.id);
    }
    const openedRound = await ensureOpenRound(config);
    return {
      processedAt: new Date().toISOString(),
      settledRoundIds,
      openedRoundId: openedRound.id,
      receivedDeposits,
      warnings
    };
  }

  const data = await readFileData(config);
  const nowMs = Date.now();
  const dueRounds = data.rounds.filter(
    (round) => round.status === "open" && new Date(round.endsAt).getTime() <= nowMs
  );
  for (const round of dueRounds) {
    round.status = "locking";
    round.updatedAt = new Date().toISOString();
    await settleOneFileRound(round, data, sendPayout);
    settledRoundIds.push(round.id);
  }
  await ensureOpenRoundInFileData(data, config);
  await writeFileData(config, data);
  const openRound = data.rounds.find((round) => round.status === "open") ?? data.rounds.at(-1);
  return {
    processedAt: new Date().toISOString(),
    settledRoundIds,
    openedRoundId: openRound?.id ?? "",
    receivedDeposits,
    warnings
  };
}

async function settleOneSqlRound(
  round: RoundRow,
  sendPayout: PayoutSender,
  config: ServerConfig
): Promise<void> {
  const sql = await getSql(config);
  const entries = await getEntriesForRound(round.id, config);
  if (entries.length === 0) {
    await sql`
      UPDATE jackpot_rounds
      SET status = 'settled', settled_at = NOW(), seed_reveal = ${round.seed_secret},
        payout_amount_usdu = '0', updated_at = NOW()
      WHERE id = ${round.id}
    `;
    await insertAudit(config, {
      roundId: round.id,
      label: "Round settled with no entries",
      detail: `Round #${round.round_number} closed without entrants. The next round is open.`,
      severity: "info"
    });
    return;
  }

  const winner = selectWinner(roundFromRow(round), entries);
  const payoutAmount = round.pot_amount_usdu.toString();
  const recipient = winner.entrantDirectAddress ?? normalizeNametag(winner.entrantNametag) ?? winner.entrantPublicKey;
  const payoutId = `payout_${crypto.randomUUID()}`;
  await sql`
    INSERT INTO jackpot_payouts (
      id, round_id, recipient, amount_usdu, status, created_at, updated_at
    )
    VALUES (${payoutId}, ${round.id}, ${recipient}, ${payoutAmount}, 'pending', NOW(), NOW())
  `;

  try {
    const txReference = await sendPayout(
      recipient,
      payoutAmount,
      `Sphere Jackpot round #${round.round_number} payout`
    );
    await sql`
      UPDATE jackpot_payouts
      SET status = 'sent', tx_reference = ${txReference}, updated_at = NOW()
      WHERE id = ${payoutId}
    `;
    await sql`
      UPDATE jackpot_rounds
      SET status = 'settled', settled_at = NOW(), seed_reveal = ${round.seed_secret},
        winner_entry_id = ${winner.id}, winner_label = ${winner.entrantLabel},
        payout_amount_usdu = ${payoutAmount}, payout_tx_reference = ${txReference},
        updated_at = NOW()
      WHERE id = ${round.id}
    `;
    await insertAudit(config, {
      roundId: round.id,
      label: "Autonomous payout sent",
      detail: `Vault agent paid ${payoutAmount} USDU to ${winner.entrantLabel} for round #${round.round_number}.`,
      severity: "success",
      txReference
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown payout failure.";
    await sql`
      UPDATE jackpot_payouts
      SET status = 'failed', error = ${message}, updated_at = NOW()
      WHERE id = ${payoutId}
    `;
    await sql`
      UPDATE jackpot_rounds
      SET status = 'payout_failed', settled_at = NOW(), seed_reveal = ${round.seed_secret},
        winner_entry_id = ${winner.id}, winner_label = ${winner.entrantLabel},
        payout_amount_usdu = ${payoutAmount}, updated_at = NOW()
      WHERE id = ${round.id}
    `;
    await insertAudit(config, {
      roundId: round.id,
      label: "Payout failed",
      detail: message,
      severity: "error"
    });
  }
}

async function settleOneFileRound(
  round: InternalRound,
  data: StoreData,
  sendPayout: PayoutSender
): Promise<void> {
  const entries = data.entries.filter((entry) => entry.roundId === round.id);
  const now = new Date().toISOString();
  if (entries.length === 0) {
    round.status = "settled";
    round.settledAt = now;
    round.seedReveal = round.seedSecret;
    round.payoutAmountUsdu = "0";
    round.updatedAt = now;
    data.audit.push(makeAuditEvent({
      roundId: round.id,
      label: "Round settled with no entries",
      detail: `Round #${round.roundNumber} closed without entrants. The next round is open.`,
      severity: "info"
    }));
    return;
  }

  const winner = selectWinner(round, entries);
  const recipient = winner.entrantDirectAddress ?? normalizeNametag(winner.entrantNametag) ?? winner.entrantPublicKey;
  const payout: JackpotPayout = {
    id: `payout_${crypto.randomUUID()}`,
    roundId: round.id,
    recipient,
    amountUsdu: round.potAmountUsdu,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  data.payouts.push(payout);

  try {
    const txReference = await sendPayout(
      recipient,
      round.potAmountUsdu,
      `Sphere Jackpot round #${round.roundNumber} payout`
    );
    payout.status = "sent";
    payout.txReference = txReference;
    payout.updatedAt = new Date().toISOString();
    round.status = "settled";
    round.payoutTxReference = txReference;
    data.audit.push(makeAuditEvent({
      roundId: round.id,
      label: "Autonomous payout sent",
      detail: `Vault agent paid ${round.potAmountUsdu} USDU to ${winner.entrantLabel} for round #${round.roundNumber}.`,
      severity: "success",
      txReference
    }));
  } catch (error) {
    payout.status = "failed";
    payout.error = error instanceof Error ? error.message : "Unknown payout failure.";
    payout.updatedAt = new Date().toISOString();
    round.status = "payout_failed";
    data.audit.push(makeAuditEvent({
      roundId: round.id,
      label: "Payout failed",
      detail: payout.error,
      severity: "error"
    }));
  }

  round.settledAt = new Date().toISOString();
  round.seedReveal = round.seedSecret;
  round.winnerEntryId = winner.id;
  round.winnerLabel = winner.entrantLabel;
  round.payoutAmountUsdu = round.potAmountUsdu;
  round.updatedAt = new Date().toISOString();
}

async function ensureOpenRound(config: ServerConfig): Promise<InternalRound> {
  if (config.databaseUrl) {
    const sql = await getSql(config);
    const [existing] = await sql<RoundRow[]>`
      SELECT * FROM jackpot_rounds WHERE status = 'open' ORDER BY round_number DESC LIMIT 1
    `;
    if (existing) return roundFromRow(existing);

    const [lastRound] = await sql<{ max_round: number | null }[]>`
      SELECT MAX(round_number) AS max_round FROM jackpot_rounds
    `;
    const nextRound = createInternalRound((lastRound?.max_round ?? 0) + 1, config);
    await sql`
      INSERT INTO jackpot_rounds (
        id, round_number, status, starts_at, ends_at, vault_recipient, entry_amount_usdu,
        pot_amount_usdu, coin_id, seed_hash, seed_secret, created_at, updated_at
      )
      VALUES (
        ${nextRound.id}, ${nextRound.roundNumber}, ${nextRound.status}, ${nextRound.startsAt},
        ${nextRound.endsAt}, ${nextRound.vaultRecipient ?? null}, ${nextRound.entryAmountUsdu},
        ${nextRound.potAmountUsdu}, ${nextRound.coinId}, ${nextRound.seedHash},
        ${nextRound.seedSecret}, ${nextRound.createdAt}, ${nextRound.updatedAt}
      )
    `;
    await insertAudit(config, {
      roundId: nextRound.id,
      label: "Round opened",
      detail: `Round #${nextRound.roundNumber} opened for ${config.roundDurationMinutes} minutes.`,
      severity: "info"
    });
    return nextRound;
  }

  const data = await readFileData(config);
  const openRound = await ensureOpenRoundInFileData(data, config);
  await writeFileData(config, data);
  return openRound;
}

async function ensureOpenRoundInFileData(data: StoreData, config: ServerConfig): Promise<InternalRound> {
  const existing = data.rounds.find((round) => round.status === "open");
  if (existing) return existing;

  const lastRoundNumber = data.rounds.reduce((max, round) => Math.max(max, round.roundNumber), 0);
  const nextRound = createInternalRound(lastRoundNumber + 1, config);
  data.rounds.push(nextRound);
  data.audit.push(makeAuditEvent({
    roundId: nextRound.id,
    label: "Round opened",
    detail: `Round #${nextRound.roundNumber} opened for ${config.roundDurationMinutes} minutes.`,
    severity: "info"
  }));
  return nextRound;
}

async function getEntriesForRound(roundId: string, config: ServerConfig): Promise<JackpotEntry[]> {
  if (config.databaseUrl) {
    const sql = await getSql(config);
    const rows = await sql<EntryRow[]>`
      SELECT * FROM jackpot_entries WHERE round_id = ${roundId} ORDER BY created_at ASC, id ASC
    `;
    return rows.map(entryFromRow);
  }
  const data = await readFileData(config);
  return data.entries.filter((entry) => entry.roundId === roundId).sort(ascByCreatedAt);
}

async function insertAudit(
  config: ServerConfig,
  event: Omit<JackpotAuditEvent, "id" | "createdAt">
): Promise<void> {
  const audit = makeAuditEvent(event);
  if (config.databaseUrl) {
    const sql = await getSql(config);
    await sql`
      INSERT INTO jackpot_audit_events (
        id, round_id, label, detail, severity, tx_reference, created_at
      )
      VALUES (
        ${audit.id}, ${audit.roundId ?? null}, ${audit.label}, ${audit.detail},
        ${audit.severity}, ${audit.txReference ?? null}, ${audit.createdAt}
      )
    `;
    return;
  }
  const data = await readFileData(config);
  data.audit.push(audit);
  await writeFileData(config, data);
}

async function getSql(config: ServerConfig): Promise<ReturnType<typeof postgres>> {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not configured.");
  if (!sqlClient) {
    sqlClient = postgres(config.databaseUrl, {
      max: 3,
      prepare: false,
      idle_timeout: 20
    });
  }
  if (!sqlReady) {
    await ensureSqlSchema(sqlClient);
    sqlReady = true;
  }
  return sqlClient;
}

async function ensureSqlSchema(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS jackpot_rounds (
      id TEXT PRIMARY KEY,
      round_number INTEGER UNIQUE NOT NULL,
      status TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      settled_at TIMESTAMPTZ,
      vault_recipient TEXT,
      entry_amount_usdu NUMERIC NOT NULL,
      pot_amount_usdu NUMERIC NOT NULL DEFAULT 0,
      coin_id TEXT NOT NULL,
      seed_hash TEXT NOT NULL,
      seed_secret TEXT NOT NULL,
      seed_reveal TEXT,
      winner_entry_id TEXT,
      winner_label TEXT,
      payout_amount_usdu NUMERIC,
      payout_tx_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jackpot_entries (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES jackpot_rounds(id),
      round_number INTEGER NOT NULL,
      entry_kind TEXT NOT NULL,
      entrant_label TEXT NOT NULL,
      entrant_public_key TEXT NOT NULL,
      entrant_direct_address TEXT,
      entrant_nametag TEXT,
      amount_usdu NUMERIC NOT NULL,
      weight INTEGER NOT NULL,
      memo TEXT NOT NULL,
      tx_reference TEXT NOT NULL,
      tx_reference_hash TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jackpot_payouts (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES jackpot_rounds(id),
      recipient TEXT NOT NULL,
      amount_usdu NUMERIC NOT NULL,
      status TEXT NOT NULL,
      tx_reference TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jackpot_audit_events (
      id TEXT PRIMARY KEY,
      round_id TEXT,
      label TEXT NOT NULL,
      detail TEXT NOT NULL,
      severity TEXT NOT NULL,
      tx_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS jackpot_entries_round_idx ON jackpot_entries(round_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS jackpot_audit_created_idx ON jackpot_audit_events(created_at DESC)`;
}

async function readFileData(config: ServerConfig): Promise<StoreData> {
  try {
    const raw = await fs.readFile(config.storageFile, "utf8");
    return JSON.parse(raw) as StoreData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const data: StoreData = { rounds: [], entries: [], payouts: [], audit: [] };
    await ensureOpenRoundInFileData(data, config);
    await writeFileData(config, data);
    return data;
  }
}

async function writeFileData(config: ServerConfig, data: StoreData): Promise<void> {
  await fs.mkdir(path.dirname(config.storageFile), { recursive: true });
  await fs.writeFile(config.storageFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function createInternalRound(roundNumber: number, config: ServerConfig): InternalRound {
  const now = Date.now();
  const seedSecret = crypto.randomBytes(32).toString("hex");
  return {
    id: `round_${roundNumber}_${crypto.randomBytes(4).toString("hex")}`,
    roundNumber,
    status: "open",
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + config.roundDurationMinutes * 60_000).toISOString(),
    vaultRecipient: config.vaultRecipient || undefined,
    entryAmountUsdu: normalizeAmount(config.entryAmountUsdu),
    potAmountUsdu: "0",
    coinId: USDU_COIN_ID,
    seedHash: sha256(seedSecret),
    seedSecret,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  };
}

function selectWinner(round: InternalRound, entries: JackpotEntry[]): JackpotEntry {
  const sortedEntries = entries.slice().sort(ascByCreatedAt);
  const totalWeight = sortedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) throw new Error("Cannot select a winner without entry weight.");

  const entryCommitment = sortedEntries.map((entry) => entry.id).sort().join("|");
  const digest = sha256(`${round.seedSecret}:${round.id}:${round.endsAt}:${entryCommitment}`);
  let target = BigInt(`0x${digest.slice(0, 16)}`) % BigInt(totalWeight);

  for (const entry of sortedEntries) {
    const weight = BigInt(entry.weight);
    if (target < weight) return entry;
    target -= weight;
  }
  return sortedEntries[sortedEntries.length - 1];
}

function assertRoundAcceptsEntries(round: InternalRound | RoundRow | undefined): asserts round {
  if (!round) throw new Error("Round not found.");
  const status = "status" in round ? round.status : undefined;
  const endsAt = "endsAt" in round ? round.endsAt : round.ends_at;
  if (status !== "open") throw new Error("Round is not open.");
  if (new Date(endsAt).getTime() <= Date.now()) {
    throw new Error("Round entry window has ended. Wait for settlement.");
  }
}

async function toPublicRound(round: RoundRow, entries: JackpotEntry[]): Promise<PublicRound> {
  return toPublicRoundFromInternal(roundFromRow(round), entries);
}

function toPublicRoundFromInternal(round: InternalRound, entries: JackpotEntry[]): PublicRound {
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status: round.status,
    startsAt: round.startsAt,
    endsAt: round.endsAt,
    settledAt: round.settledAt,
    vaultRecipient: round.vaultRecipient,
    entryAmountUsdu: normalizeAmount(round.entryAmountUsdu),
    potAmountUsdu: normalizeAmount(round.potAmountUsdu),
    coinId: round.coinId,
    seedHash: round.seedHash,
    seedReveal: round.seedReveal,
    winnerEntryId: round.winnerEntryId,
    winnerLabel: round.winnerLabel,
    payoutAmountUsdu: round.payoutAmountUsdu ? normalizeAmount(round.payoutAmountUsdu) : undefined,
    payoutTxReference: round.payoutTxReference,
    entryCount: entries.length,
    totalWeight: entries.reduce((sum, entry) => sum + entry.weight, 0)
  };
}

function roundFromRow(row: RoundRow): InternalRound {
  return {
    id: row.id,
    roundNumber: row.round_number,
    status: row.status,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    settledAt: row.settled_at ? toIso(row.settled_at) : undefined,
    vaultRecipient: row.vault_recipient ?? undefined,
    entryAmountUsdu: row.entry_amount_usdu.toString(),
    potAmountUsdu: row.pot_amount_usdu.toString(),
    coinId: row.coin_id,
    seedHash: row.seed_hash,
    seedSecret: row.seed_secret,
    seedReveal: row.seed_reveal ?? undefined,
    winnerEntryId: row.winner_entry_id ?? undefined,
    winnerLabel: row.winner_label ?? undefined,
    payoutAmountUsdu: row.payout_amount_usdu?.toString(),
    payoutTxReference: row.payout_tx_reference ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function entryFromRow(row: EntryRow): JackpotEntry {
  return {
    id: row.id,
    roundId: row.round_id,
    roundNumber: row.round_number,
    kind: row.entry_kind,
    entrantLabel: row.entrant_label,
    entrantPublicKey: row.entrant_public_key,
    entrantDirectAddress: row.entrant_direct_address ?? undefined,
    entrantNametag: row.entrant_nametag ?? undefined,
    amountUsdu: normalizeAmount(row.amount_usdu.toString()),
    weight: row.weight,
    memo: row.memo,
    txReference: row.tx_reference,
    txReferenceHash: row.tx_reference_hash,
    status: row.status,
    createdAt: toIso(row.created_at)
  };
}

function payoutFromRow(row: PayoutRow): JackpotPayout {
  return {
    id: row.id,
    roundId: row.round_id,
    recipient: row.recipient,
    amountUsdu: normalizeAmount(row.amount_usdu.toString()),
    status: row.status,
    txReference: row.tx_reference ?? undefined,
    error: row.error ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function auditFromRow(row: AuditRow): JackpotAuditEvent {
  return {
    id: row.id,
    roundId: row.round_id ?? undefined,
    label: row.label,
    detail: row.detail,
    severity: row.severity,
    txReference: row.tx_reference ?? undefined,
    createdAt: toIso(row.created_at)
  };
}

function makeAuditEvent(event: Omit<JackpotAuditEvent, "id" | "createdAt">): JackpotAuditEvent {
  return {
    id: `audit_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...event
  };
}

function normalizeNametag(nametag: string | undefined): string | undefined {
  if (!nametag) return undefined;
  return nametag.startsWith("@") ? nametag : `@${nametag}`;
}

export async function getPaginatedRounds(
  skip: number,
  limit: number,
  requestUrl?: string
): Promise<{ rounds: PublicRound[]; hasMore: boolean }> {
  const config = getServerConfig(requestUrl);
  limit = Math.min(Math.max(limit, 1), 20);

  if (config.databaseUrl) {
    const sql = await getSql(config);
    const rows = await sql<RoundRow[]>`
      SELECT * FROM jackpot_rounds
      WHERE status <> 'open'
      ORDER BY round_number DESC
      LIMIT ${limit + 1} OFFSET ${skip}
    `;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const rounds = await Promise.all(
      rows.map(async (round) => toPublicRound(round, await getEntriesForRound(round.id, config)))
    );
    return { rounds, hasMore };
  }

  const data = await readFileData(config);
  const settled = data.rounds
    .filter((round) => round.status !== "open")
    .sort((a, b) => b.roundNumber - a.roundNumber);
  const page = settled.slice(skip, skip + limit + 1);
  const hasMore = page.length > limit;
  if (hasMore) page.pop();
  return {
    rounds: page.map((round) => toPublicRoundFromInternal(
      round,
      data.entries.filter((entry) => entry.roundId === round.id)
    )),
    hasMore
  };
}

export async function getPaginatedAudit(
  cursor: string | undefined,
  limit: number,
  requestUrl?: string
): Promise<{ events: JackpotAuditEvent[]; nextCursor?: string }> {
  const config = getServerConfig(requestUrl);
  limit = Math.min(Math.max(limit, 1), 50);

  if (config.databaseUrl) {
    const sql = await getSql(config);
    const rows = cursor
      ? await sql<AuditRow[]>`
          SELECT * FROM jackpot_audit_events
          WHERE id < ${cursor}
          ORDER BY id DESC
          LIMIT ${limit + 1}
        `
      : await sql<AuditRow[]>`
          SELECT * FROM jackpot_audit_events
          ORDER BY id DESC
          LIMIT ${limit + 1}
        `;

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return {
      events: rows.map(auditFromRow),
      nextCursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : undefined
    };
  }

  const data = await readFileData(config);
  const sorted = data.audit.slice().sort(descByCreatedAt);
  const startIndex = cursor ? sorted.findIndex((e) => e.id === cursor) + 1 : 0;
  const page = sorted.slice(startIndex, startIndex + limit + 1);
  const hasMore = page.length > limit;
  if (hasMore) page.pop();
  return {
    events: page,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : undefined
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ascByCreatedAt(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function descByCreatedAt(left: { createdAt: string }, right: { createdAt: string }): number {
  return right.createdAt.localeCompare(left.createdAt);
}
