import { NextRequest, NextResponse } from "next/server";

import { getAgentEntryCard } from "@/lib/server/jackpot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const card = await getAgentEntryCard(request.url);
    return NextResponse.json(card);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build agent entry card." },
      { status: 500 }
    );
  }
}
