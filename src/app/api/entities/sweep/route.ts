import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import {
  readLastRun,
  readSweepSettings,
  runSweep,
  SweepSettingsError,
  writeSweepSettings,
} from "@/lib/sweep";
import { resolveUserDataRoots } from "@/lib/user-data-paths";

/**
 * Scheduled collection (CR-20260911-scheduled-sweep).
 *
 * Settings and the round itself live on one route because they are one feature and the
 * board is the only caller. GET reads the settings plus when the last round ran; PUT
 * changes the settings; POST runs one round — `force` is the 「立即巡检一轮」 button,
 * which is the user's own action and therefore allowed while the schedule is off.
 */

type Guarded = { ok: true; entitiesRoot: string } | { ok: false; response: NextResponse };

async function guard(): Promise<Guarded> {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ message: auth.message }, { status: auth.status }) };
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return { ok: false, response: unavailable };
  }
  const { entitiesRoot } = await resolveUserDataRoots(auth.userId);
  return { ok: true, entitiesRoot };
}

export async function GET() {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const store = getStore();
  return NextResponse.json({ ...readSweepSettings(store), lastRun: readLastRun(store) });
}

export async function PUT(request: Request) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = getStore();
  try {
    const settings = writeSweepSettings(store, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      intervalMinutes: body.intervalMinutes === undefined ? undefined : Number(body.intervalMinutes),
      maxPerRound: body.maxPerRound === undefined ? undefined : Number(body.maxPerRound),
    });
    return NextResponse.json({ ok: true, ...settings, lastRun: readLastRun(store) });
  } catch (error) {
    if (error instanceof SweepSettingsError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const store = getStore();
  const outcome = await runSweep({ store, force: body.force === true, root: entitiesRoot });
  return NextResponse.json({ ...outcome, lastRun: readLastRun(store) });
}
