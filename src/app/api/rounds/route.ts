import { NextRequest, NextResponse } from "next/server";

import { getPaginatedRounds } from "@/lib/server/jackpot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skip = Number.parseInt(searchParams.get("skip") ?? "0", 10) || 0;
    const limit = Number.parseInt(searchParams.get("limit") ?? "5", 10) || 5;
    const result = await getPaginatedRounds(skip, limit, request.url);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[rounds] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load rounds." },
      { status: 500 }
    );
  }
}
