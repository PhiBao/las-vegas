export const APP_NAME = "Las Vegas";
export const APP_DESCRIPTION =
  "A testnet jackpot where humans and agents enter with Sphere, and an autonomous vault settles every round.";

export const SPHERE_WALLET_URL = "https://sphere.unicity.network";
export const SPHERE_NETWORK_NAME = "testnet2" as const;
export const SDK_NETWORK_NAME = "testnet";
export const WALLET_API_URL = "https://wallet-api.unicity.network";
export const DEFAULT_ORACLE_API_KEY = "sk_ddc3cfcc001e4a28ac3fad7407f99590";

export const USDU_SYMBOL = "USDU" as const;
export const USDU_COIN_ID = "e210f98956f564bfe67ee94fddd386b5157f660d1957169b391f962093a2da2a";
export const USDU_DECIMALS = 6;

export const DEFAULT_ENTRY_AMOUNT_USDU = "1";
export const DEFAULT_TEST_USDU_MINT_AMOUNT = "100";
export const DEFAULT_ROUND_DURATION_MINUTES = 5;
export const LOCAL_STORAGE_WARNING =
  "Local file storage is only for development. Use DATABASE_URL before submitting a live public app.";

const BASE_UNIT_FACTOR = 10n ** BigInt(USDU_DECIMALS);

export function toBaseUnits(value: string | number): string {
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid ${USDU_SYMBOL} amount: ${raw}`);
  }

  const [whole, fraction = ""] = raw.split(".");
  const normalizedFraction = fraction.padEnd(USDU_DECIMALS, "0").slice(0, USDU_DECIMALS);
  return (BigInt(whole) * BASE_UNIT_FACTOR + BigInt(normalizedFraction || "0")).toString();
}

export function fromBaseUnits(value: string | bigint): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const whole = amount / BASE_UNIT_FACTOR;
  const fraction = amount % BASE_UNIT_FACTOR;
  const fractionText = fraction.toString().padStart(USDU_DECIMALS, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

export function addDecimalStrings(left: string, right: string): string {
  return fromBaseUnits(BigInt(toBaseUnits(left)) + BigInt(toBaseUnits(right)));
}

export function normalizeAmount(value: string | number): string {
  return fromBaseUnits(toBaseUnits(value));
}

export function makeEntryMemo(roundId: string, entrantLabel: string): string {
  const safeLabel = entrantLabel.replace(/[^a-zA-Z0-9@._:-]/g, "").slice(0, 48) || "entrant";
  return `JACKPOT:${roundId}:${safeLabel}`;
}
