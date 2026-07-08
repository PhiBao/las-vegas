import { NextRequest, NextResponse } from "next/server";

import { createJackpotEntry } from "@/lib/server/jackpot-store";
import type { CreateEntryInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = (await request.json()) as Partial<CreateEntryInput>;
    validateInput(input);
    const result = await createJackpotEntry(input, request.url);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create jackpot entry.";
    const status = /required|must be|not configured|not open|ended|amount|memo|wallet|reference|not found/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function validateInput(input: Partial<CreateEntryInput>): asserts input is CreateEntryInput {
  if (!input.roundId || typeof input.roundId !== "string") throw new Error("roundId is required.");
  if (input.kind !== "human" && input.kind !== "agent") throw new Error("kind must be human or agent.");
  if (!input.entrant?.label || !input.entrant.publicKey) throw new Error("entrant identity is required.");
  if (!input.amountUsdu || typeof input.amountUsdu !== "string") throw new Error("amountUsdu is required.");
  if (!input.memo || typeof input.memo !== "string") throw new Error("memo is required.");
  if (!input.txReference || typeof input.txReference !== "string") throw new Error("txReference is required.");
}
