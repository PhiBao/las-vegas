const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const url = process.env.JACKPOT_TICK_URL ?? (appUrl ? `${appUrl}/api/agent/tick` : "http://localhost:3000/api/agent/tick");

const headers = {};
if (process.env.CRON_SECRET) {
  headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
}

const response = await fetch(url, {
  method: "POST",
  headers
});
const payload = await response.json().catch(() => ({}));

console.log(JSON.stringify(payload, null, 2));
if (!response.ok) {
  process.exitCode = 1;
}
