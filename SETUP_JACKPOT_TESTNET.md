# Las Vegas — Testnet Setup

This app works with real Unicity Sphere `testnet2` wallet actions. Follow this guide to deploy a live testnet instance.

## Quick Start

```bash
pnpm install
cp .env.example .env
# Edit .env with your values (see steps below)
pnpm dev
```

## 1. Create a vault wallet

A dedicated testnet-only wallet for the jackpot vault. Do NOT use a personal wallet.

```bash
node scripts/create-vault-wallet.mjs sphere-jackpot-vault
```

This outputs:
- A **mnemonic** (copy this immediately — it's not stored anywhere)
- The registered **nametag** (`@sphere-jackpot-vault`)
- An automatic **100 USDU mint** to fund initial payouts

Save the mnemonic for step 4.

## 2. Set up Neon Postgres (free tier)

Vercel Postgres is deprecated. Use [Neon](https://neon.tech) free tier (512MB, 190 compute hours/month).

1. Sign up at https://neon.tech
2. Create a new project (any region)
3. Copy the connection string from the Neon dashboard:
   ```
   postgres://neondb_owner:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. The app auto-creates 4 tables on first request: `jackpot_rounds`, `jackpot_entries`, `jackpot_payouts`, `jackpot_audit_events`

## 3. Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Or connect your GitHub repo in the Vercel dashboard for automatic deploys
```

## 4. Configure environment variables

Set these in **Vercel Dashboard → Settings → Environment Variables** (or in your local `.env` for development):

### Required for live deployment

| Variable | Value | Source |
|----------|-------|--------|
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Your Vercel deployment URL |
| `NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT` | `@sphere-jackpot-vault` | From step 1 |
| `DATABASE_URL` | `postgres://neondb_owner:...@ep-xxx.neon.tech/...` | From Neon dashboard |
| `JACKPOT_VAULT_MNEMONIC` | `twelve or twenty four words` | From step 1 (copy immediately!) |
| `JACKPOT_VAULT_NAMETAG` | `sphere-jackpot-vault` | From step 1 |
| `CRON_SECRET` | Generate a random string | Run `openssl rand -hex 32` |

### Optional tuning

| Variable | Default | Notes |
|----------|---------|-------|
| `ROUND_DURATION_MINUTES` | `240` | Use `5` for demos, `240` for production |
| `JACKPOT_ENTRY_AMOUNT_USDU` | `1` | Entry cost in USDU |
| `SPHERE_ORACLE_API_KEY` | Public testnet2 key | Only override if you have a custom key |

## 5. Top up the vault wallet

After deployment, mint more test USDU to fund payouts:

```bash
JACKPOT_VAULT_MNEMONIC="your mnemonic" pnpm mint:test-usdu
# Or with custom amount:
JACKPOT_VAULT_MNEMONIC="your mnemonic" node scripts/mint-test-usdu.mjs 500
```

## 6. Verify the flow

### Local testing

```bash
pnpm dev
# Open http://localhost:3000
```

### Manual tick test

```bash
# Set CRON_SECRET in .env first
pnpm agent:tick
```

### E2E checklist

1. Open the app
2. Click **Connect Sphere** → approve in Sphere wallet
3. Click **Mint USDU** → approve mint intent
4. Click **Enter current round** → approve send intent
5. Verify entry appears in round feed, pot increases
6. Wait for round to expire (or set `ROUND_DURATION_MINUTES=5`)
7. Run `pnpm agent:tick` or wait for Vercel cron (every 5 min)
8. Check winner tape and vault audit for seed reveal + payout

### Smoke test

```bash
pnpm smoke
```

## 7. What is real

- Sphere wallet connection on `testnet2` via SDK `autoConnect`
- USDU mint intent through Sphere
- Entry payment through real Sphere `send` intent
- Server-side vault wallet initialized from `JACKPOT_VAULT_MNEMONIC`
- Vault receive and payout through the Sphere SDK
- Persistent Postgres storage via Neon
- Autonomous settlement via Vercel Cron (every 5 minutes)
- Commit-reveal randomness for winner selection

## 8. Architecture

```
Browser (JackpotVaultApp.tsx)
  ├── Connect Sphere → autoConnect popup
  ├── Mint USDU → sphere.payments.mint()
  ├── Enter round → sphere.payments.send() → POST /api/entries
  └── Poll /api/state every 15s

Server (Next.js API Routes)
  ├── GET  /api/state          → Full public round state
  ├── POST /api/entries        → Record a jackpot entry
  ├── GET  /api/agent-entry-card → Machine-readable agent card
  ├── GET  /api/health         → Health check + config status
  └── POST /api/agent/tick     → Autonomous vault settlement (cron)

Vault Agent (runs via cron every 5 min)
  ├── receiveVaultDeposits()   → sphere.payments.receive()
  ├── settleDueRounds()        → Lock expired rounds, select winner
  └── sendVaultPayout()        → sphere.payments.send() to winner
```

## 9. Scope notes

This is testnet-only. It is not a real-money gambling product and does not claim production-grade randomness. The MVP uses commit-reveal randomness suitable for contest validation: the vault commits a seed hash when a round opens, reveals the seed at settlement, and computes the winner from the seed plus the sorted entry IDs.
