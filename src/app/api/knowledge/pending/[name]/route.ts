import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { adoptPending, discardPending, KNOWLEDGE_ROOT } from "@/lib/knowledge";

/**
 * The approval step for model-proposed knowledge (REQ-F-046 ③; TASK-084).
 * POST adopts (moves the file into the searchable set), DELETE discards. Until one of
 * these happens the proposal is invisible to `search_knowledge`.
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
  const entry = await adoptPending(name, KNOWLEDGE_ROOT);
  if (!entry) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(_request: Request, { params }: Params) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const removed = await discardPending(name, KNOWLEDGE_ROOT);
  if (!removed) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
