import { NextRequest, NextResponse } from "next/server";

import { getJackpotState } from "@/lib/server/jackpot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const state = await getJackpotState(request.url);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load jackpot state." },
      { status: 500 }
    );
  }
}
