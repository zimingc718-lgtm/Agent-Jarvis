import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { readWakeSettings, readWakeUsage, WakeSettingsError, writeWakeSettings } from "@/lib/wake";

/**
 * Proactive wake-up configuration (REQ-F-060 ①②③; TASK-101). Its own ☰ entry, like
 * 「搜索」: the 「模型」 dialog stays the provider surface (REQ-NF-006 ②).
 */

async function guard() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  return storageUnavailable();
}

export async function GET() {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const store = getStore();
  return NextResponse.json({ ...readWakeSettings(store), usage: readWakeUsage(store) });
}

export async function PUT(request: Request) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = getStore();
  try {
    const settings = writeWakeSettings(store, {
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      dailyTokenCap: body.dailyTokenCap,
    });
    return NextResponse.json({ ok: true, ...settings, usage: readWakeUsage(store) });
  } catch (error) {
    if (error instanceof WakeSettingsError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }
}
