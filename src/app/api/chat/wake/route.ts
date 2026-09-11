import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { runWakeTurn } from "@/lib/wake";

/**
 * One proactive wake-up (REQ-F-060 ④⑤, REQ-F-061; TASK-101). Plain JSON, not SSE: a
 * wake is a single bounded call whose result is either nothing or one short line.
 * The server enforces the switch and the daily cap — the client timer is only a
 * trigger, never the authority on whether tokens get spent.
 */
export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const body = (await request.json().catch(() => ({}))) as { manual?: unknown };
  const outcome = await runWakeTurn({ store: getStore(), userId: auth.userId, manual: body.manual === true });
  return NextResponse.json(outcome);
}
