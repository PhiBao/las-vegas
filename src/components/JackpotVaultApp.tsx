"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coins,
  Copy,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Trophy,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { APP_NAME } from "@/lib/constants";
import { connectSphereWallet, mintTestUsdu, sendJackpotEntry } from "@/lib/wallet";
import type { AgentEntryCard, JackpotAuditEvent, PublicJackpotState, WalletRuntime } from "@/lib/types";

type BusyState = "connect" | "mint" | "enter" | "refresh" | "card" | null;

export function JackpotVaultApp() {
  const [state, setState] = useState<PublicJackpotState | null>(null);
  const [agentCard, setAgentCard] = useState<AgentEntryCard | null>(null);
  const [walletRuntime, setWalletRuntime] = useState<WalletRuntime | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());

  const loadState = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Failed to load jackpot state.");
    setState(payload as PublicJackpotState);
  }, []);

  useEffect(() => {
    const load = () => {
      void loadState().catch((error) => {
        setNotice(error instanceof Error ? error.message : "Failed to load jackpot state.");
      });
    };
    const initial = window.setTimeout(load, 0);
    const refresh = window.setInterval(() => {
      void loadState().catch(() => undefined);
    }, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
      window.clearInterval(clock);
    };
  }, [loadState]);

  const timeLeft = useMemo(() => {
    if (!state) return "";
    return formatDuration(new Date(state.currentRound.endsAt).getTime() - now);
  }, [now, state]);

  async function handleRefresh() {
    setBusy("refresh");
    try {
      await loadState();
      setNotice("Round state refreshed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    setBusy("connect");
    setNotice("Opening Sphere wallet — approve the connection in the popup.");
    try {
      const runtime = await connectSphereWallet();
      window.focus();
      setWalletRuntime(runtime);
      setNotice("Sphere wallet connected on testnet2.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sphere connection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleMint() {
    setBusy("mint");
    setNotice("Opening Sphere wallet — approve the mint intent in the popup.");
    try {
      const result = await mintTestUsdu(walletRuntime);
      window.focus();
      setNotice(`Mint request submitted. ${shortReference(result)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mint failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleEnter() {
    if (!state) return;
    setBusy("enter");
    setNotice("Opening Sphere wallet — approve the send intent in the popup.");
    try {
      const entryIntent = await sendJackpotEntry(
        walletRuntime,
        state.currentRound,
        state.config.entryAmountUsdu
      );
      window.focus();
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roundId: state.currentRound.id,
          kind: "human",
          entrant: walletRuntime?.connection,
          amountUsdu: state.config.entryAmountUsdu,
          memo: entryIntent.memo,
          txReference: entryIntent.txReference
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Entry recording failed.");
      setState(payload.state as PublicJackpotState);
      setNotice("Entry confirmed. The vault pot and public audit feed are updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Entry failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAgentCard() {
    setBusy("card");
    try {
      const response = await fetch("/api/agent-entry-card", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Agent card failed.");
      setAgentCard(payload as AgentEntryCard);
      setNotice("Agent entry card loaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Agent card failed.");
    } finally {
      setBusy(null);
    }
  }

  async function copyAgentCard() {
    if (!agentCard) return;
    await navigator.clipboard.writeText(JSON.stringify(agentCard, null, 2));
    setNotice("Agent entry card copied.");
  }

  const round = state?.currentRound;
  const configured = Boolean(state?.config.vaultConfigured);
  const canEnter = Boolean(walletRuntime && round?.status === "open" && configured);
  const setupWarnings = state
    ? [
        !state.config.vaultConfigured ? "Vault recipient missing" : "",
        !state.config.settlementConfigured ? "Payout wallet missing" : "",
        state.config.persistence === "local-file" ? "Local storage mode" : ""
      ].filter(Boolean)
    : [];

  return (
    <main className="app-shell">
      <header className="topbar" aria-label={APP_NAME}>
        <div className="brand">
          <span className="brand-mark">
            <Trophy size={20} />
          </span>
          <div>
            <strong>{APP_NAME}</strong>
            <small>Autonomous testnet rounds</small>
          </div>
        </div>
        <div className="wallet-cluster">
          {walletRuntime ? (
            <div className="wallet-connected">
              <CheckCircle2 size={17} />
              <div>
                <strong>{walletRuntime.connection.label}</strong>
                <span>Sphere testnet2</span>
              </div>
            </div>
          ) : null}
          <button className="secondary-button" type="button" onClick={handleRefresh} disabled={busy !== null}>
            {busy === "refresh" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            Refresh
          </button>
          {walletRuntime ? (
            <button className="secondary-button" type="button" onClick={handleMint} disabled={busy !== null}>
              {busy === "mint" ? <LoaderCircle className="spin" size={16} /> : <Coins size={16} />}
              Mint USDU
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={handleConnect} disabled={busy !== null}>
              {busy === "connect" ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}
              Connect Sphere
            </button>
          )}
        </div>
      </header>

      {notice ? (
        <div className="notice" role="status">
          <Activity size={18} />
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>
            x
          </button>
        </div>
      ) : null}

      <section className="vault-stage">
        <div className="vault-copy">
          <p className="eyebrow">Games track · Agentic build</p>
          <h1>Enter the vault. Let the agent settle.</h1>
          <p>
            Every round accepts real Sphere testnet entries. When the clock ends, the vault agent
            reveals the seed, pays the winner, and opens the next round.
          </p>
          <div className="status-strip">
            <StatusPill icon={<ShieldCheck size={15} />} label="Network" value="testnet2" />
            <StatusPill icon={<Timer size={15} />} label="Round" value={round ? `#${round.roundNumber}` : "..."} />
            <StatusPill icon={<Bot size={15} />} label="Agent" value={state?.config.settlementConfigured ? "armed" : "setup"} />
          </div>
        </div>

        <div className="vault-panel" aria-live="polite">
          <div className="vault-visual">
            <div className="vault-ring">
              <div className="vault-core">
                <span>Pot</span>
                <strong>{round ? `${round.potAmountUsdu} USDU` : "..."}</strong>
              </div>
            </div>
          </div>
          <div className="round-meta">
            <Metric label="Closes in" value={round?.status === "open" ? timeLeft : "settling"} />
            <Metric label="Entries" value={round ? round.entryCount.toString() : "..."} />
            <Metric label="Your cost" value={state ? `${state.config.entryAmountUsdu} USDU` : "..."} />
          </div>
          {setupWarnings.length ? (
            <div className="setup-warning">
              <AlertTriangle size={18} />
              <span>{setupWarnings.join(" · ")}</span>
            </div>
          ) : null}
          <button className="primary-button enter-button" type="button" onClick={handleEnter} disabled={!canEnter || busy !== null}>
            {busy === "enter" ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            Enter current round
          </button>
          <div className="seed-line">
            <span>Seed commit</span>
            <code>{round ? shortHash(round.seedHash) : "..."}</code>
          </div>
        </div>
      </section>

      <section className="product-grid">
        <section className="activity-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live entries</p>
              <h2>Round feed</h2>
            </div>
            <Sparkles size={20} />
          </div>
          <div className="feed-list">
            {state?.recentEntries.length ? (
              state.recentEntries.map((entry) => (
                <article className="feed-item" key={entry.id}>
                  <div className="entry-kind">{entry.kind === "agent" ? <Bot size={16} /> : <Wallet size={16} />}</div>
                  <div>
                    <strong>{entry.entrantLabel}</strong>
                    <span>
                      Round #{entry.roundNumber} · {entry.amountUsdu} USDU · {formatTime(entry.createdAt)}
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState text="No entries yet. First transfer sets the pot." />
            )}
          </div>
        </section>

        <section className="activity-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Autonomous agent</p>
              <h2>Agent entry card</h2>
            </div>
            <Bot size={20} />
          </div>
          <p className="panel-copy">
            Agents can enter by reading this card, sending the round payment with Sphere, then posting
            the signed wallet result back to the entry API.
          </p>
          <div className="button-row left">
            <button className="secondary-button" type="button" onClick={handleAgentCard} disabled={busy !== null}>
              {busy === "card" ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}
              Load card
            </button>
            <button className="secondary-button" type="button" onClick={copyAgentCard} disabled={!agentCard}>
              <Copy size={16} />
              Copy JSON
            </button>
          </div>
          <pre className="agent-card">{agentCard ? JSON.stringify(agentCard, null, 2) : "GET /api/agent-entry-card"}</pre>
        </section>

        <section className="activity-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settled rounds</p>
              <h2>Winner tape</h2>
            </div>
            <Trophy size={20} />
          </div>
          <div className="winner-list">
            {state?.recentRounds.length ? (
              state.recentRounds.map((pastRound) => (
                <article className="winner-item" key={pastRound.id}>
                  <strong>Round #{pastRound.roundNumber}</strong>
                  <span>{pastRound.winnerLabel ?? "No winner"}</span>
                  <small>{pastRound.payoutAmountUsdu ?? "0"} USDU</small>
                </article>
              ))
            ) : (
              <EmptyState text="Winners appear after the first autonomous settlement." />
            )}
          </div>
        </section>

        <section className="activity-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Proof trail</p>
              <h2>Vault audit</h2>
            </div>
            <ShieldCheck size={20} />
          </div>
          <div className="audit-list">
            {state?.audit.length ? (
              state.audit.map((event) => <AuditLine event={event} key={event.id} />)
            ) : (
              <EmptyState text="Audit events will stream here." />
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatusPill({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="status-pill">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuditLine({ event }: { event: JackpotAuditEvent }) {
  return (
    <article className={`audit-line ${event.severity}`}>
      <span>{formatTime(event.createdAt)}</span>
      <strong>{event.label}</strong>
      <p>{event.detail}</p>
      {event.txReference ? <code>{shortReference(event.txReference)}</code> : null}
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, "0")).join(":");
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function shortReference(value: string): string {
  if (value.length <= 88) return value;
  return `${value.slice(0, 52)}...${value.slice(-24)}`;
}
