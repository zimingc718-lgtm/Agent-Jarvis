import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { adoptPendingEntity, discardPendingEntity, ENTITIES_ROOT } from "@/lib/entities";

/**
 * The approval step for model-proposed entities (CR-20260911-home-dashboard).
 * POST adopts, DELETE discards. Until one of them happens the proposal is invisible to
 * the board and to `list_entities`.
 */

type Params = { params: Promise<{ name: string }> };

async function guard() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  return storageUnavailable();
}

export async function POST(_request: Request, { params }: Params) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entity = await adoptPendingEntity(name, ENTITIES_ROOT);
  if (!entity) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const removed = await discardPendingEntity(name, ENTITIES_ROOT);
  if (!removed) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
