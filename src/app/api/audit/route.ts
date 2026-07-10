import { NextRequest, NextResponse } from "next/server";

import { getPaginatedAudit } from "@/lib/server/jackpot-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20;
    const result = await getPaginatedAudit(cursor, limit, request.url);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[audit] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load audit events." },
      { status: 500 }
    );
  }
}
