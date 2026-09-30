import { NextResponse } from "next/server";
import { healthReport } from "@/lib/health";
import { readLanguage } from "@/lib/language";
import { getStorageConfig } from "@/lib/runtime-config";
import { getStore } from "@/lib/store-singleton";

/**
 * `/api/health` (REQ-NF-063 ①, DEC-490 ①; CR-20260929-health-logging). The one route without
 * the identity guard: Railway's deployment health check and the local probe both read it, and
 * neither has a session. It says only what `health.ts` allows a stranger to know.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, report } = healthReport({
    configured: getStorageConfig().configured,
    probeStore: () => void readLanguage(getStore()),
  });
  return NextResponse.json(report, { status, headers: { "cache-control": "no-store" } });
}
