import { NextRequest, NextResponse } from "next/server";

import { getPublicConfig, getSetupWarnings } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    config: getPublicConfig(request.url),
    warnings: getSetupWarnings(request.url)
  });
}
