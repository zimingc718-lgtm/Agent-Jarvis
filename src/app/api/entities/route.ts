import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ENTITIES_ROOT, EntityError, isEntityKind, listEntities, listPendingEntities, saveEntity } from "@/lib/entities";
import { listProposals } from "@/lib/entity-proposals";

/**
 * The board's data (CR-20260911-home-dashboard).
 *
 * GET returns the three queues the dashboard renders: live entities, entities the model
 * proposed, and field changes the model proposed. POST creates an entity directly,
 * because that path is the user's own action — only the model has to go through
 * `pending/`.
 */

export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const [entities, pending, proposals] = await Promise.all([
    listEntities(ENTITIES_ROOT),
    listPendingEntities(ENTITIES_ROOT),
    listProposals(ENTITIES_ROOT),
  ]);
  return NextResponse.json({ entities, pending, proposals });
}

export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isEntityKind(body.kind)) {
    return NextResponse.json({ message: "kind 必须是 competitor、authority 或 customer 之一。" }, { status: 400 });
  }
  try {
    const entity = await saveEntity(
      {
        kind: body.kind,
        title: typeof body.title === "string" ? body.title : "",
        summary: typeof body.summary === "string" ? body.summary : "",
        capacity: typeof body.capacity === "string" ? body.capacity : "",
        nextLabel: typeof body.nextLabel === "string" ? body.nextLabel : "",
        nextDate: typeof body.nextDate === "string" ? body.nextDate : "",
        sources: Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string") : [],
        body: typeof body.body === "string" ? body.body : "",
      },
      ENTITIES_ROOT
    );
    return NextResponse.json({ ok: true, entity }, { status: 201 });
  } catch (error) {
    if (error instanceof EntityError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "实体保存失败。" }, { status: 500 });
  }
}
