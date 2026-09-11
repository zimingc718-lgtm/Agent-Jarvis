import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ENTITIES_ROOT } from "@/lib/entities";
import { adoptProposal, discardProposal } from "@/lib/entity-proposals";

/**
 * The approval step for model-proposed FIELD changes (CR-20260911-home-dashboard).
 * A change whose source was already registered on the entity never reaches here; it was
 * applied at the tool boundary. Everything else waits for a click.
 */

type Params = { params: Promise<{ id: string }> };

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
  const id = decodeURIComponent((await params).id ?? "").trim();
  const entity = await adoptProposal(id, ENTITIES_ROOT);
  if (!entity) {
    return NextResponse.json({ message: `没有编号为「${id}」的待采纳修改，或它指向的对象已不存在。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const id = decodeURIComponent((await params).id ?? "").trim();
  const removed = await discardProposal(id, ENTITIES_ROOT);
  if (!removed) {
    return NextResponse.json({ message: `没有编号为「${id}」的待采纳修改。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
