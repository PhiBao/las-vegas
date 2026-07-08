import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";

const port = process.env.SMOKE_PORT ?? "3100";
let baseUrl = process.env.SMOKE_URL ?? "";
const storageFile = `.data/smoke-jackpot-${port}.json`;
const executablePath =
  process.env.CHROMIUM_EXECUTABLE ??
  (existsSync("/home/kiter/.local/bin/chromium") ? "/home/kiter/.local/bin/chromium" : undefined);

let server = null;
let browser = null;

async function main() {
  await rm(storageFile, { force: true });

  if (!baseUrl) {
    baseUrl = `http://localhost:${port}`;
  }

  if (!process.env.SMOKE_URL && baseUrl === `http://localhost:${port}`) {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", port], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        JACKPOT_STORAGE_FILE: storageFile,
        NEXT_PUBLIC_JACKPOT_VAULT_RECIPIENT: "@smoke-vault",
        ROUND_DURATION_MINUTES: "240"
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    server.stdout.on("data", (chunk) => process.stdout.write(chunk));
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }

  await waitForServer(baseUrl);

  browser = await chromium.launch({
    executablePath,
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Enter the vault/i }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /Connect Sphere/i }).waitFor();
  await page.getByRole("button", { name: /Enter current round/i }).waitFor();
  await page.getByText(/Round feed/i).waitFor();
  await page.getByText(/Payout wallet missing/i).waitFor();

  await page.getByRole("button", { name: /Load card/i }).click();
  await page.getByText(/sphere-jackpot-v1/i).waitFor({ timeout: 5000 });

  const state = await fetchJson(`${baseUrl}/api/state`);
  assert(state.currentRound.status === "open", "expected an open round");
  assert(state.config.network === "testnet2", "expected testnet2 config");
  assert(state.config.vaultRecipient === "@smoke-vault", "expected smoke vault recipient");

  const card = await fetchJson(`${baseUrl}/api/agent-entry-card`);
  assert(card.version === "sphere-jackpot-v1", "expected agent card version");
  assert(card.roundId === state.currentRound.id, "expected agent card for current round");

  const invalidEntry = await fetch(`${baseUrl}/api/entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert(invalidEntry.status === 400, "expected invalid entry to be rejected");

  const tick = await fetchJson(`${baseUrl}/api/agent/tick`);
  assert(typeof tick.openedRoundId === "string", "expected tick result");

  await browser.close();
  browser = null;
  console.log("Las Vegas smoke passed");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (browser) void browser.close();
    stopServer();
  });

function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}
