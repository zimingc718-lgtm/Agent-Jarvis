import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { readEntity } from "@/lib/entities";
import { MAX_HISTORY_READ, readHistory } from "@/lib/entity-history";
import { resolveUserDataRoots } from "@/lib/user-data-paths";

/**
 * One entity's message history — read-only (CR-20260918-change-history-and-sources, CP-1).
 * A sibling of `[name]/route.ts`'s own guard, not a shared helper: the existing file
 * keeps its four-action `guard()` private to itself, and duplicating six lines here
 * costs less than reaching into another route module's internals.
 */

type Params = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const blocked = storageUnavailable();
  if (blocked) {
    return blocked;
  }
  const { entitiesRoot } = await resolveUserDataRoots(auth.userId);
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entity = await readEntity(name, entitiesRoot);
  if (!entity) {
    return NextResponse.json({ message: `没有名为「${name}」的跟踪对象。` }, { status: 404 });
  }
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_HISTORY_READ) : MAX_HISTORY_READ;
  const entries = await readHistory(name, entitiesRoot, limit);
  return NextResponse.json({ entries });
}
