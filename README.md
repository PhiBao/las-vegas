# Las Vegas

A real-time jackpot game built on [Unicity Sphere](https://www.unicity.ai/developers) where humans and autonomous agents compete in recurring rounds. An autonomous vault agent receives deposits, closes expired rounds, reveals a committed seed, pays the winner, and opens the next round — all on the Sphere testnet with no central server holding funds.

**Contest track:** Games · **Bonus:** Agentic Build

## What this does

Every round, players send 1 USDU (a testnet token) to a vault wallet using Sphere peer-to-peer payments. When the round timer expires, an autonomous agent automatically:

1. **Locks** the round — no more entries accepted
2. **Selects a winner** using commit-reveal randomness (SHA-256 seed committed at round start, revealed at settlement)
3. **Pays the winner** — sends the entire pot to the winner's Sphere wallet
4. **Opens the next round** — fresh seed, fresh timer

Humans enter through the browser. Agents enter by reading a machine-readable entry card and calling the API. Both paths result in a real Sphere `send` intent that moves tokens peer-to-peer.

## Why it exists

This is a **contest submission** for the Unicity Sphere hackathon. It demonstrates:

- **Real peer-to-peer settlement** — no mock transactions, no fake wallets. Every entry and payout is a real Sphere `send` intent on testnet2.
- **Autonomous agent settlement** — a vault agent runs via Cloudflare Worker cron (every 30 minutes), receives deposits, and settles rounds without human intervention.
- **Agent-to-agent commerce** — external autonomous agents can discover the jackpot via `/api/agent-entry-card`, read the round state, send payment, and register their entry programmatically.
- **Commit-reveal fairness** — the vault commits a SHA-256 seed hash when a round opens and reveals the seed at settlement. The winner is deterministically computed from the seed plus sorted entry IDs.

## How it works

### For humans

1. Open the app
2. Click **Connect Sphere** — approve the wallet connection popup
3. Click **Mint USDU** — mint test tokens to your wallet
4. Click **Enter current round** — send 1 USDU to the vault with a bound memo
5. Wait for the round to expire
6. The vault agent settles automatically — check the winner tape and audit trail

### For agents

```bash
# 1. Read the current round
curl https://las-vegas-beta.vercel.app/api/agent-entry-card

# 2. Send the payment via Sphere SDK
# (use the vaultRecipient, amount, and memo from the card)

# 3. Register your entry
curl -X POST https://las-vegas-beta.vercel.app/api/entries \
  -H "content-type: application/json" \
  -d '{
    "roundId": "<roundId from card>",
    "kind": "agent",
    "entrant": { "label": "my-agent", "publicKey": "...", "mode": "sphere" },
    "amountUsdu": "1",
    "memo": "<memo from card>",
    "txReference": "<Sphere send result>"
  }'
```

### Autonomous settlement

A **Cloudflare Worker** (`las-vegas-tick-cron`) calls `/api/agent/tick` every 30 minutes:

- Receives pending deposits from the Sphere delivery mailbox
- Locks any expired rounds
- Selects a winner using commit-reveal randomness
- Sends the pot to the winner
- Opens the next round

30 minutes is sufficient because rounds are 4 hours long — the worst case delay after a round expires is 30 minutes, which is acceptable for a game.

Manual trigger:
```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://las-vegas-beta.vercel.app/api/agent/tick
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                      │
│                                                          │
│  JackpotVaultApp.tsx                                     │
│  ├── Polls /api/state every 15s                          │
│  ├── Sphere wallet connection (autoConnect)              │
│  ├── Mint test USDU via Sphere intent                    │
│  ├── Enter round via Sphere send intent → POST /entries  │
│  └── Load agent entry card from /api/agent-entry-card    │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (fetch)
┌──────────────────────┴───────────────────────────────────┐
│                NEXT.JS SERVER (Vercel)                   │
│                                                          │
│  /api/state          GET   Full public round state       │
│  /api/entries        POST  Record a jackpot entry        │
│  /api/agent-entry-card GET  Machine-readable agent card  │
│  /api/health         GET   Health check + config status  │
│  /api/agent/tick     POST  Vault settlement endpoint     │
│                                                          │
│  jackpot-store.ts    Data layer (Neon Postgres)          │
│  sphere-vault.ts     Server-side Sphere SDK integration  │
│  vault-agent.ts      Settlement orchestrator             │
└──────────────────────┬───────────────────────────────────┘
                       │
    ┌──────────────────┴──────────────────┐
    │                                     │
    │  Cloudflare Worker                  │
    │  las-vegas-tick-cron                │
    │  Calls /api/agent/tick every 30min  │
    │                                     │
    └──────────────────┬──────────────────┘
                       │
              @unicitylabs/sphere-sdk
                       │
              ┌────────┴────────┐
              │  Sphere Testnet2│
              │  (P2P payments) │
              └─────────────────┘
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Custom CSS (dark theme, no framework) |
| Backend | Next.js API routes (Node.js runtime) on Vercel |
| Database | Neon Postgres (free tier) |
| Cron | Cloudflare Worker (`las-vegas-tick-cron`) — every 30 min |
| Blockchain | Unicity Sphere testnet2 via `@unicitylabs/sphere-sdk` |
| Testing | Playwright smoke tests |

## Project structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent/tick/route.ts       # Vault settlement endpoint
│   │   │   ├── agent-entry-card/route.ts  # Machine-readable agent card
│   │   │   ├── entries/route.ts           # Entry recording endpoint
│   │   │   ├── health/route.ts            # Health check
│   │   │   └── state/route.ts             # Public round state
│   │   ├── globals.css                    # Dark theme styles
│   │   ├── icon.svg                       # App favicon
│   │   ├── layout.tsx                     # Root layout + metadata
│   │   └── page.tsx                       # Home page
│   ├── components/
│   │   └── JackpotVaultApp.tsx            # Main client component
│   └── lib/
│       ├── constants.ts                   # App constants, USDU math
│       ├── id.ts                          # ID generation
│       ├── types.ts                       # TypeScript types
│       ├── wallet.ts                      # Client-side Sphere operations
│       └── server/
│           ├── env.ts                     # Server config from env vars
│           ├── jackpot-store.ts           # Data persistence layer
│           ├── sphere-vault.ts            # Server-side Sphere SDK
│           └── vault-agent.ts             # Settlement orchestrator
├── scripts/
│   ├── agent-tick.mjs                     # CLI tick trigger
│   ├── create-vault-wallet.mjs            # Wallet creation tool
│   ├── mint-test-usdu.mjs                 # USDU minting tool
│   └── smoke.mjs                          # E2E smoke test
├── workers/
│   └── tick-cron/                         # Cloudflare Worker
│       ├── wrangler.toml                  # Worker config (cron: */30 * * * *)
│       └── index.js                       # Calls /api/agent/tick
├── .env.example                           # Env var template
└── SETUP_JACKPOT_TESTNET.md               # Deployment guide
```

## Quick start

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env — see SETUP_JACKPOT_TESTNET.md for required values

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

### Required for a live deployment

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Public URL for agent entry cards | `https://las-vegas-beta.vercel.app` |
| `NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT` | Vault wallet address (nametag or DIRECT) | `@sphere-jackpot-vault` |
| `DATABASE_URL` | Neon Postgres connection string | `postgresql://...neon.tech/...` |
| `JACKPOT_VAULT_MNEMONIC` | Vault wallet mnemonic (NEVER commit this) | `twelve words...` |
| `CRON_SECRET` | Bearer token for tick auth (shared with CF Worker) | `openssl rand -hex 32` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `JACKPOT_VAULT_NAMETAG` | — | Vault nametag (without @) |
| `SPHERE_ORACLE_API_KEY` | Public testnet2 key | Override if you have a custom key |
| `ROUND_DURATION_MINUTES` | `240` | Round length in minutes |
| `JACKPOT_ENTRY_AMOUNT_USDU` | `1` | Entry cost in USDU |

### Local development only

| Variable | Default | Description |
|----------|---------|-------------|
| `JACKPOT_STORAGE_FILE` | `.data/jackpot-store.json` | Local file persistence (no Postgres needed) |
| `JACKPOT_WALLET_DATA_DIR` | `.data/jackpot-vault/wallet` | Sphere wallet key storage |
| `JACKPOT_WALLET_TOKENS_DIR` | `.data/jackpot-vault/tokens` | Sphere token storage |

Full setup instructions: [SETUP_JACKPOT_TESTNET.md](./SETUP_JACKPOT_TESTNET.md)

## API reference

### `GET /api/state`

Returns the full public jackpot state: current round, recent entries, past rounds, payouts, and audit trail.

### `POST /api/entries`

Records a jackpot entry. Requires a valid Sphere transaction reference.

```json
{
  "roundId": "round_1_abc123",
  "kind": "human",
  "entrant": {
    "label": "player-name",
    "publicKey": "02...",
    "mode": "sphere"
  },
  "amountUsdu": "1",
  "memo": "JACKPOT:round_1_abc123:player-name",
  "txReference": "..."
}
```

### `GET /api/agent-entry-card`

Returns a machine-readable JSON card with everything an agent needs to enter the current round: vault recipient, coin ID, amount, memo, callback URL, and step-by-step instructions.

### `POST /api/agent/tick`

Triggers vault settlement. Authenticated via `Authorization: Bearer $CRON_SECRET`. Called every 30 minutes by the Cloudflare Worker. Can also be triggered manually.

### `GET /api/health`

Returns config status and setup warnings. Useful for verifying deployment health.

## Cloudflare Worker

The vault settlement cron runs as a Cloudflare Worker (`las-vegas-tick-cron`) instead of Vercel Cron, avoiding Vercel's cron job limits.

**Worker details:**
- **Name:** `las-vegas-tick-cron`
- **URL:** `https://YOUR-WORKER.workers.dev`
- **Schedule:** Every 30 minutes (`*/30 * * * *`)
- **Secrets:** `CRON_SECRET`, `TICK_URL`

**To update TICK_URL** (after Vercel deploy):
```bash
echo "https://YOUR-VERCEL-URL/api/agent/tick" | wrangler secret put TICK_URL
```

**To deploy the worker locally:**
```bash
cd workers/tick-cron
CLOUDFLARE_API_TOKEN="your-token" CLOUDFLARE_ACCOUNT_ID="your-id" wrangler deploy
```

## Available scripts

| Script | Command | Description |
|--------|---------|-------------|
| Dev | `pnpm dev` | Start development server |
| Build | `pnpm build` | Production build |
| Lint | `pnpm lint` | Run ESLint |
| Create vault | `pnpm create-vault` | Generate a new testnet2 wallet |
| Mint USDU | `pnpm mint:test-usdu` | Top up vault wallet with test tokens |
| Agent tick | `pnpm agent:tick` | Trigger vault settlement manually |
| Smoke test | `pnpm smoke` | Run Playwright E2E tests |

## What is real

Everything in this app is real on the Unicity Sphere testnet2:

- **Wallet connection** — SDK `autoConnect` with real identity and session management
- **Token minting** — USDU minted through Sphere's token engine (not a faucet)
- **Entry payments** — Real peer-to-peer `send` intent to the vault wallet
- **Vault settlement** — Server-side wallet initialized from mnemonic, receives deposits, sends payouts
- **Persistence** — Neon Postgres with auto-created schema (4 tables)
- **Autonomous agent** — Cloudflare Worker cron triggers settlement every 30 minutes

## Scope notes

This is testnet-only. It is not a real-money gambling product and does not claim production-grade randomness. The commit-reveal scheme is suitable for contest validation: the vault commits a seed hash when a round opens, reveals the seed at settlement, and computes the winner from the seed plus sorted entry IDs.

## License

Built for the Unicity Sphere hackathon.
