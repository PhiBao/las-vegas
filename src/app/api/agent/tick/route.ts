import { NextRequest, NextResponse } from "next/server";

import { getServerConfig } from "@/lib/server/env";
import { runVaultAgentTick } from "@/lib/server/vault-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleTick(request);
}

export async function POST(request: NextRequest) {
  return handleTick(request);
}

async function handleTick(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized vault tick." }, { status: 401 });
  }

  try {
    const result = await runVaultAgentTick(request.url);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Vault tick failed." },
      { status: 500 }
    );
  }
}

function isAuthorized(request: NextRequest): boolean {
  const config = getServerConfig(request.url);
  if (!config.cronSecret && process.env.NODE_ENV !== "production") return true;
  if (!config.cronSecret) return false;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = request.nextUrl.searchParams.get("secret");
  return bearer === config.cronSecret || querySecret === config.cronSecret;
}
