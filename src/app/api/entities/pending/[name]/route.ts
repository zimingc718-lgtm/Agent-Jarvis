import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { adoptPendingEntity, discardPendingEntity } from "@/lib/entities";
import { resolveUserDataRoots } from "@/lib/user-data-paths";

/**
 * The approval step for model-proposed entities (CR-20260911-home-dashboard).
 * POST adopts, DELETE discards. Until one of them happens the proposal is invisible to
 * the board and to `list_entities`.
 */

type Params = { params: Promise<{ name: string }> };

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

export async function POST(_request: Request, { params }: Params) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entity = await adoptPendingEntity(name, entitiesRoot);
  if (!entity) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const name = decodeURIComponent((await params).name ?? "").trim();
  const removed = await discardPendingEntity(name, entitiesRoot);
  if (!removed) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
